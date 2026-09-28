# Credential storage for a local Bun app

Research date: 2026-09-28. All claims below carry a primary-source URL. Anything
I could not confirm from a primary source is marked **UNVERIFIED**.

> **This is the evidence behind [ADR 0014](../adr/0014-sessions-in-the-os-vault.md),
> not a plan.** Its conclusion — use `Bun.secrets`, do not store the password — is
> what was implemented. Read it as a record of what was investigated and why the
> alternatives were rejected, not as current guidance.
>
> Two things changed after it was written, both found by reviewing the code it led
> to. **The recommendation it rejected an option for is now the one in use:** it
> weighed storing a `password`, and the answer was no — persist the *session*
> instead. And it recommends an `expiresAt` field where the code uses a sliding
> `at`, deliberately. The `UNVERIFIED` markers are left as the researcher wrote
> them rather than quietly upgraded to fact.

---

## What this app should do

**Use `Bun.secrets`. Nothing else.**

Bun already ships the exact primitive this app needs, in the runtime the app
already runs on. `Bun.secrets` on Windows is a thin, first-party wrapper over
`CredWriteW` / `CredReadW` with `CRED_TYPE_GENERIC`
([`src/jsc/bindings/SecretsWindows.cpp`](https://github.com/oven-sh/bun/blob/main/src/jsc/bindings/SecretsWindows.cpp)),
and the official docs name the backends explicitly:

> It uses:
> - **macOS**: Keychain Services
> - **Linux**: libsecret (GNOME Keyring, KWallet, and other secret service daemons)
> - **Windows**: Windows Credential Manager
>
> — [bun.com/docs/runtime/secrets](https://bun.com/docs/runtime/secrets) (doc source: [`docs/runtime/secrets.mdx`](https://github.com/oven-sh/bun/blob/main/docs/runtime/secrets.mdx))

Confirmed present on this machine, with no dependency to add:

```
$ bun --version
1.4.2
$ bun -e "console.log(Object.keys(Bun.secrets))"
[ "get", "set", "delete" ]
```

Three reasons this beats everything else:

1. **Microsoft ranks it above DPAPI.** The current Windows guidance puts
   Credential Manager first and DPAPI second:
   > Use the Windows Credential Manager. Call `CredWrite` and `CredRead` to store
   > and retrieve credentials in the OS credential vault, which encrypts them
   > with the user's logon session key.
   >
   > Use DPAPI for local secret storage. Call `CryptProtectData` to encrypt
   > secrets that must be persisted locally. DPAPI ties encryption to the user
   > account or machine, providing defense-in-depth.
   >
   > — [Handling Passwords (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/win32/secbp/handling-passwords)

2. **It is the intended shape of the data.** A `CRED_TYPE_GENERIC` entry is
   literally "a username and password for a third-party site", which is the
   problem statement, not a generic blob we have to design a schema for.

3. **The expiry date is ours to keep, not the store's to enforce.** Neither DPAPI
   nor Credential Manager has an expiry concept. Store `expiresAt` as a plain
   sibling field and check it on read. This app already does the equivalent for
   its own session cookie (30 days, derived `Max-Age`), so the pattern exists.

The honest caveat, in Bun's favour: it is documented as new and experimental —
> `<Warning>This API is new and experimental. It may change in the future.</Warning>`

— [bun.com/docs/runtime/secrets](https://bun.com/docs/runtime/secrets)

— and there are live, open Windows-specific bugs. See
[Known problems](#known-problems-to-check-in-issue-0001).

---

## Comparison table

| # | Option | Verdict | One-line reason |
|---|---|---|---|
| 1 | **`Bun.secrets`** (Windows Credential Manager / macOS Keychain / Linux libsecret) | **USE THIS** | Already installed, first-party, backed by the OS store Microsoft ranks above DPAPI |
| 2 | **Windows Credential Manager via `bun:ffi`** (`CredWriteW`/`CredReadW`) | Fallback only | Same store, but hand-rolled FFI; `bun:ffi` is documented experimental and leaks memory management onto us |
| 3 | **DPAPI via `bun:ffi`** (`CryptProtectData`) | No | Microsoft says use Credential Manager for this shape of data; we would be inventing a container format and a file location for no gain |
| 4 | **DPAPI via a Node-API native module** | No | Correct, but it is a build step and a `.node` binary to ship for a job `Bun.secrets` already does |
| 5 | **Browser password manager / `autocomplete` tokens** | Do not build on it | Works for *the human* filling a form. It cannot drive a Bun server process to log in unattended. See [Q3](#3-browser-password-managers--autocomplete-tokens) |
| 6 | **WebDriver autofill** | Does not exist | Zero occurrences of "autofill" in the 1.87 MB W3C WebDriver spec. There is no standard command |
| 7 | **Web Crypto `CryptoKey`, non-extractable, in IndexedDB** | No | Non-extractable stops *export*. It does nothing against script that can *call decrypt*. See [Q4](#4-web-crypto-what-subtlecrypto-actually-gives-you) |
| 8 | **Web Crypto AES-GCM, key derived in the page** | No | The key is in the same JS realm as the ciphertext. This is obfuscation |
| 9 | **`localStorage`** | No | Plaintext, origin-wide, readable by any script, survives nothing useful |
| 10 | **Plaintext / hand-rolled ciphertext in `bun:sqlite` or a file** | No | `bun:sqlite` has no encryption; the file's protection is the folder's ACL and nothing else |
| 11 | **`Bun.secrets` + `pass` / `bw` / `op` as a shim** | Later, maybe | Correct but adds an external process and a master-password prompt to a single-user local app |
| 12 | **Encrypted file in the repo** | Never | This repo is under `C:\Users\manoh\OneDrive\` — a secrets file here is uploaded to OneDrive |

---

## 1. Windows DPAPI / `CryptProtectData`

### The API

`CryptProtectData` lives in `Crypt32.dll`, header `dpapi.h`, import lib
`Crypt32.lib`.
— [CryptProtectData function (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)

### The entropy parameter

`pOptionalEntropy` is an extra secret you must also supply at decrypt time. It
does not change *who* can decrypt — it changes *what* you have to know.

> A pointer to a DATA_BLOB structure that contains a password or other
> additional entropy used to encrypt the data. The **DATA_BLOB** structure used
> in the encryption phase must also be used in the decryption phase. This
> parameter can be set to NULL for no additional entropy.
>
> — [CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)

Note what it is *not*: it is not a key-derivation salt, and it is not a second
factor. If your entropy comes from a file next to the ciphertext, or from
anything the app can compute without the user, DPAPI's own binding is doing all
the work and entropy added nothing. For a single-user local app whose server
process must be able to decrypt unattended, there is nowhere sensible to put
entropy. This is why the recommendation is `CRED_PERSIST_*` + the OS store, not
DPAPI + entropy.

### Is the blob bound to the user account? Does it survive machine changes?

> Typically, only a user with the same logon credential as the user who encrypted
> the data can decrypt the data. In addition, the encryption and decryption
> usually must be done on the same computer. For information about exceptions,
> see Remarks.
>
> — [CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)

And the exception:

> However, a user with a roaming profile can decrypt the data from another
> computer on the network.
>
> — [CryptProtectData, Remarks](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)

So: **usually machine-bound, and roaming-profile is the documented escape
hatch.** This is exactly the "does it survive machine changes" question, and the
answer is "not on a normal machine, yes if the account roams."

Also, `CRYPTPROTECT_LOCAL_MACHINE` is the flag that removes user binding
entirely, and its doc states the consequence plainly:

> When this flag is set, it associates the data encrypted with the current
> computer instead of with an individual user. **Any user on the computer** on
> which `CryptProtectData` is called can use `CryptUnprotectData` to decrypt the
> data.
>
> — [CryptProtectData, dwFlags](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)

Do not pass `CRYPTPROTECT_LOCAL_MACHINE` for a password.

### Can a non-admin process decrypt a blob written by another process under the same account?

**Yes.** This is the single most important fact in this document, and it applies
equally to DPAPI, to Credential Manager, and to `Bun.secrets`.

DPAPI's binding is to the *logon credential*, not to a process, a PID, or a
signature. MSDN's own wording is "only a user with the same logon credential" —
that is an account-level boundary. There is no per-application boundary and
there never was. Two independent confirmations:

1. **Chromium relies on exactly this.** Chrome's master key is written by one
   process and read by others:
   > `If an Encryptor instance is passed to a process then that process will be
   > able to decrypt any data encrypted with OSCryptAsync.`
   >
   > — [components/os_crypt/async/README.md](https://github.com/chromium/chromium/blob/main/components/os_crypt/async/README.md)

2. **Bun's own issue tracker says the same thing about `Bun.secrets`:**
   > When one bun script stores a secret via `Bun.secrets.set()`, any other bun
   > script can read it silently — no Keychain password prompt, no Touch ID, no
   > user confirmation.
   >
   > — [oven-sh/bun#28071, "Bun.secrets: secrets are accessible by any bun script without password prompt"](https://github.com/oven-sh/bun/issues/28071) (open; reported against 1.2.22/macOS)

The same issue proposes the documentation fix, which is
[oven-sh/bun#41947 "docs: warn that Bun.secrets lacks inter-script
isolation"](https://github.com/oven-sh/bun/pull/41947) (open).

**What this means for the threat model.** The realistic attacker for a local
app is malware or a hostile dependency already running as the user. Against that
attacker, DPAPI and Credential Manager are *not* a boundary — they protect
against at-rest theft (stolen laptop, backup, another local user, a synced
folder) and against an offline attacker who has the file but not the user's
logon session. That is a real and worthwhile class of protection. It is not a
defence against code execution as the user. Any document claiming otherwise is
overselling.

### Can Bun call DPAPI?

There is **no Bun-native DPAPI function.** `Bun.secrets` is a native Windows
Credential Manager wrapper, not a DPAPI wrapper — DPAPI is used *underneath it by
Windows itself*, which is not something a process chooses. A search of the Bun
issue tracker for `DPAPI` returns three hits, none of which is a DPAPI feature
request, and a search for `CryptProtectData` returns zero.
— [oven-sh/bun issues, `?q=DPAPI`](https://github.com/oven-sh/bun/issues?q=DPAPI) · [`?q=CryptProtectData`](https://github.com/oven-sh/bun/issues?q=CryptProtectData)

However, `bun:ffi` **can** reach it. Confirmed by read-only symbol resolution on
this machine — no call, no write, nothing stored:

```
Advapi32 CredReadW  @ [Function: CredReadW]
Advapi32 CredWriteW @ [Function: CredWriteW]
Crypt32   CryptProtectData @ [Function: CryptProtectData]
```

The mechanism is documented and officially supported on Windows: `bun:ffi`'s
`suffix` is `"dll"` on Windows, and the docs carry a Windows-specific note about
`HANDLE` needing `u64` rather than `ptr`.
— [Bun FFI](https://bun.com/docs/runtime/ffi)

Against that, the same page opens with:

> `<Warning>` `bun:ffi` is **experimental**, with known bugs and limitations. Do
> not rely on it in production. The most stable way to interact with native code
> from Bun is to write a Node-API module.
> `</Warning>`
>
> — [Bun FFI](https://bun.com/docs/runtime/ffi)

**Verdict on the FFI route: it works, and it is the wrong tool.** It is
reachable, but it puts `LocalFree` calls, `DATA_BLOB` marshalling, and
`LocalFree`-on-error paths into your code, in exchange for reimplementing
something `Bun.secrets` already ships. `bun:ffi`'s own memory-management section
is a fair summary of the trade: "`bun:ffi` does not manage memory for you. You
must free the memory when you're done with it."
— [Bun FFI](https://bun.com/docs/runtime/ffi)

---

## 2. Windows Credential Manager (`CredWrite` / `CredRead`), `Generic` type

### Is it a better fit than DPAPI for "a username and password for a third-party site"?

**Yes, and Microsoft's own guidance says so.** From the preference order in
[Handling Passwords](https://learn.microsoft.com/en-us/windows/win32/secbp/handling-passwords):

> **Modern credential management** — For new development on Windows, use these
> approaches in preference order:
> 1. Eliminate passwords where possible. Use Windows Hello, passkeys
>    (FIDO2/WebAuthn), or certificate-based authentication to avoid handling
>    passwords altogether.
> 2. **Use the Windows Credential Manager.** Call `CredWrite` and `CredRead` to
>    store and retrieve credentials in the OS credential vault, which encrypts
>    them with the user's logon session key.
> 3. Use DPAPI for local secret storage. Call `CryptProtectData` to encrypt
>    secrets that must be persisted locally. DPAPI ties encryption to the user
>    account or machine, providing defense-in-depth.

Credential Manager is item 2. DPAPI is item 3.

### What `CRED_TYPE_GENERIC` actually is

> **CRED_TYPE_GENERIC** — 1 (0x1) — The credential is a generic credential. The
> credential will not be used by any particular authentication package. The
> credential will be stored securely but has no other significant
> characteristics.
>
> — [CREDENTIALW structure (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)

Two consequences worth knowing before writing a serializer:

- **`TargetName` is the identity**, together with `Type`. For `CRED_TYPE_GENERIC`
  it should name the service, and Microsoft prescribes prefixing:
  > If the `Type` is CRED_TYPE_GENERIC, this member should identify the service
  > that uses the credential in addition to the actual target. Microsoft suggests
  > the name be prefixed by the name of the company implementing the service.
  > This member cannot be longer than **CRED_MAX_GENERIC_TARGET_NAME_LENGTH**
  > (32767) characters. This member is case-insensitive.
  >
  > — [CREDENTIALW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)

- **`UserName` is ignored for `CRED_TYPE_GENERIC`:**
  > If the credential `Type` is CRED_TYPE_GENERIC, this member can be non-`NULL`,
  > but the credential manager ignores the member.
  >
  > — [CREDENTIALW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)

That last one matters for this app. `Bun.secrets` maps `service` + `name` into
`TargetName` as `service + "/" + name`
([`SecretsWindows.cpp`](https://github.com/oven-sh/bun/blob/main/src/jsc/bindings/SecretsWindows.cpp)),
so there is no `UserName` field to fill. Keep the ECAP user name inside the
stored value, or in the `name` half of the key. Not a blocker; just do not go
looking for a username field in the struct.

Also from the same page, for sizing the blob:

> `CredentialBlobSize` — The size, in bytes, of the `CredentialBlob` member.
> This member cannot be larger than **CRED_MAX_CREDENTIAL_BLOB_SIZE** (5\*512)
> bytes.
>
> — [CREDENTIALW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)

2560 bytes. An ECAP user name and password fit easily.

### `Persist`: the field that actually encodes the roaming question

> - **CRED_PERSIST_SESSION** — 1 (0x1) — The credential persists for the life of
>   the logon session. It will not be visible to other logon sessions of this
>   same user. It will not exist after this user logs off and back on.
> - **CRED_PERSIST_LOCAL_MACHINE** — 2 (0x2) — The credential persists for all
>   subsequent logon sessions on this same computer. It is visible to other
>   logon sessions of this same user on this same computer and not visible to
>   logon sessions for this user on other computers.
> - **CRED_PERSIST_ENTERPRISE** — 3 (0x3) — The credential persists for all
>   subsequent logon sessions on this same computer. It is visible to other
>   logon sessions of this same user on this same computer and to logon sessions
>   for this user on other computers.
>
> — [CREDENTIALW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)

For a portal password on a personal dev machine, `CRED_PERSIST_LOCAL_MACHINE`
is the correct answer: the credential must outlive one logon session, and it
should not follow the user to another machine.

`Bun.secrets` exposes exactly this. Its Windows default is
`CRED_PERSIST_ENTERPRISE`:
> Persisted with the `CRED_PERSIST_ENTERPRISE` flag by default, so they're
> scoped per user
>
> — [bun.com/docs/runtime/secrets](https://bun.com/docs/runtime/secrets)

and the `persist: "local"` option was added in
[oven-sh/bun#42161, "secrets: add a persist option for Windows Credential
Manager entries"](https://github.com/oven-sh/bun/pull/42161) (merged). That PR
states the default and why it matters:
> On Windows, `Bun.secrets.set()` always writes the entry with `Persist =
> CRED_PERSIST_ENTERPRISE` … When the account has roaming state, the same user
> sees the entry on other computers. A caller cannot keep a secret on one
> computer.

**Checked on this machine: `bun-types@1.4.2` does not declare `persist?` on
`secrets.set`.** The types shipped with the pinned `bun-types` show only
`{service, name, value}`. The option exists in current Bun; whether it is
present in the installed 1.4.2 build is **UNVERIFIED** — a grep of the local
type definitions found no `persist?:`, which suggests the runtime may not honour
it either. Verify at runtime before relying on it. If it is unavailable, the
fallback is the same store read through `bun:ffi` with an explicit `Persist`.

### Read and write semantics

> The `CredRead` function reads a credential from the user's credential set. The
> credential set used is the one associated with the logon session of the
> current token. The token must not have the user's SID disabled.
>
> — [CredReadW function (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credreadw)

> The new credential is associated with the logon session of the current token.
> The token must not have the user's SID disabled.
>
> This function creates a credential if a credential with the specified
> `TargetName` and `Type` does not exist. If a credential with the specified
> `TargetName` and `Type` exists, the new specified credential replaces the
> existing one.
>
> — [CredWriteW function (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credwritew)

Write is upsert. Good — no read-modify-write dance, and the same holds for
`Bun.secrets.set` ("If a credential already exists for the given service/name
combination, Bun replaces it", [bun.com/docs/runtime/secrets](https://bun.com/docs/runtime/secrets)).

**The test harness for your own confidence:** entries are visible in
Control Panel → Credential Manager → Windows Credentials.
— [bun.com/docs/runtime/secrets](https://bun.com/docs/runtime/secrets)

That is also the manual "forget this password" escape hatch, which is worth
offering in the UI.

---

## 3. Browser password managers / `autocomplete` tokens

### The actual spec mechanism

The attribute is `autocomplete`, and the governing algorithm is
[§4.10.19.7.1 "Autofilling form controls: the `autocomplete` attribute"](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofilling-form-controls:-the-autocomplete-attribute)
in the WHATWG HTML Standard.

The attribute wears one of two mantles. In the normal case:

> In all other cases, it wears the **autofill expectation mantle**. When wearing
> the autofill expectation mantle, the `autocomplete` attribute, if specified,
> must have a value that is an ordered set of space-separated tokens consisting
> of either a single token that is an ASCII case-insensitive match for the
> string "off", or a single token that is an ASCII case-insensitive match for
> the string "on", or autofill detail tokens.
>
> — [WHATWG HTML, autofill](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofilling-form-controls:-the-autocomplete-attribute)

The autofill detail tokens include, verbatim from the token list:

> `name` `honorific-prefix` `given-name` `additional-name` `family-name`
> `honorific-suffix` `nickname` `username` `new-password` `current-password`
> `one-time-code` `organization-title` `organization` `street-address` …
>
> — [WHATWG HTML, autofill detail tokens](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofilling-form-controls:-the-autocomplete-attribute)

So the correct markup for this app's sign-in form is
`autocomplete="username"` on the user-name input and
`autocomplete="current-password"` on the password input. MDN's descriptions
match: `current-password` is "The user's current password."
— [MDN: `autocomplete`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete)

One detail worth knowing, because it is the usual reason people reach for
`autocomplete="off"` and then give up:
> In most modern browsers, setting `autocomplete` to "off" will not prevent a
> password manager from asking the user if they would like to save username and
> password information, or from automatically filling in those values in a site's
> login form.
>
> — [MDN: `autocomplete`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete)

**This is a real feature and it should be in the app regardless.** If the user
is already typing the password into the form, having Chrome/Edge remember and
refill it costs nothing and is strictly better than a bespoke mechanism. It is
just not the answer to the request, which is unattended server-side auto-login.

### How Chrome/Edge on Windows back the stored credential

The pipeline is two layers, and the first layer is what people usually get
wrong. **Chrome does not hand DPAPI the password.** It generates a 32-byte
random AES key, DPAPI-protects *that key*, stores it in the `Local State`
prefs file, and encrypts each `Login Data` row with AES-256-GCM under it.

The master key, from Chromium's source:

> ```cpp
> // Contains base64 random key encrypted with DPAPI.
> constexpr char kOsCryptEncryptedKeyPrefName[] = "os_crypt.encrypted_key";
> // Key prefix for a key encrypted with DPAPI.
> constexpr char kDPAPIKeyPrefix[] = "DPAPI";
> ```
>
> — [components/os_crypt/async/browser/os_crypt_win.cc](https://github.com/chromium/chromium/blob/main/components/os_crypt/async/browser/os_crypt_win.cc)

The `CryptProtectData` call — note `pOptionalEntropy` is `nullptr` and the flag
is `CRYPTPROTECT_AUDIT`, not `CRYPTPROTECT_LOCAL_MACHINE`:

> ```cpp
> result = ::CryptProtectData(
>     /*pDataIn=*/&input,
>     /*szDataDescr=*/ ... ,
>     /*pOptionalEntropy=*/nullptr,
>     /*pvReserved=*/nullptr,
>     /*pPromptStruct=*/nullptr, /*dwFlags=*/CRYPTPROTECT_AUDIT,
>     /*pDataOut=*/&output);
> ```
>
> — [os_crypt_win.cc](https://github.com/chromium/chromium/blob/main/components/os_crypt/async/browser/os_crypt_win.cc)

The key is generated and stored:

> ```cpp
> std::string key(Encryptor::Key::kAES256GCMKeySize, '\0');
> crypto::RandBytes(base::as_writable_byte_span(key));
> if (!EncryptAndStoreKey(key, local_state)) { return false; }
> ```
>
> — [os_crypt_win.cc](https://github.com/chromium/chromium/blob/main/components/os_crypt/async/browser/os_crypt_win.cc)

The password store is migrated onto that machinery, and it is the default path:

> `// Phase 1 of OSCryptMigration is enabled by default since M133.`
> `// Phase 2 of OSCryptMigration is also enabled by default since M137.`
>
> — [components/password_manager/core/browser/os_crypt_async_migrator.cc](https://github.com/chromium/chromium/blob/main/components/password_manager/core/browser/os_crypt_async_migrator.cc)

and the row cipher is AES-256-GCM:

> `case mojom::Algorithm::kAES256GCM: { CHECK_EQ(key.size(), Key::kAES256GCMKeySize); }`
>
> — [components/os_crypt/async/common/encryptor.cc](https://github.com/chromium/chromium/blob/main/components/os_crypt/async/common/encryptor.cc)

The component's stated purpose:

> This directory contains `OSCrypt` implementations that support cryptographic
> primitives that allow binding data to the OS user.
>
> — [components/os_crypt/README.md](https://github.com/chromium/chromium/blob/main/components/os_crypt/README.md)

**What this teaches us, and what it does not.** It confirms the *pattern* this
research recommends: a random key, wrapped by the OS account, protecting the
payload. Chromium built that because it needs to encrypt thousands of rows
efficiently. A local app storing one credential does not — Windows Credential
Manager already does the wrap, keyed to the logon session, and gives you a
managed store on top. Building the two-layer scheme by hand would be copying
Chrome's answer to a problem Chrome has and this app does not.

### WebDriver autofill

**There is no standard WebDriver autofill command.** Verified by full-text search
of the W3C WebDriver spec (1,876,979 characters):
`autofill` → 0 occurrences; `password manager` → 0 occurrences. `credential`
appears 15 times, all WebAuthn or extension credential related.
— [W3C WebDriver](https://w3c.github.io/webdriver/)

So there is nothing to call from Playwright to make a browser password manager
fill a form. Noted as a verified negative, not a gap in my research.

---

## 4. Web Crypto: what `SubtleCrypto` actually gives you in a browser

### Is there a non-extractable key? Yes.

`CryptoKey.extractable`:
> The read-only **`extractable`** property of the `CryptoKey` interface indicates
> whether or not the key may be extracted using `SubtleCrypto.exportKey()` or
> `SubtleCrypto.wrapKey()`.
>
> — [MDN: `CryptoKey.extractable`](https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey/extractable)

and you set it at import time:
> **`extractable`** (boolean) — A boolean value indicating whether it will be
> possible to export the key using `SubtleCrypto.exportKey()` or
> `SubtleCrypto.wrapKey()`.
>
> — [MDN: `SubtleCrypto.importKey()`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey)

### Where is it stored?

The spec does not say, and says so bluntly:
> Authors should be aware that this specification places no normative
> requirements on implementations as to how the underlying cryptographic key
> material is stored. **The only requirement is that key material is not exposed
> to script**, except through the use of the `exportKey` and `wrapKey`
> operations. **In particular, it does not guarantee that the underlying
> cryptographic key material will not be persisted to disk, possibly
> unencrypted**, nor that it will be inaccessible to users or other
> applications running with the same privileges as the User Agent. **Any
> application or user that has access to the device storage may be able to
> recover the key material, even through scripts may be prohibited.**
>
> — [Web Cryptography Level 2, §6.2 "Security considerations for authors"](https://www.w3.org/TR/WebCryptoAPI/#security-developers)

On persistence, the spec's expectation is IndexedDB:
> In practice, it is expected that most authors will make use of the Indexed
> Database API … which allows the storage and retrieval of key material,
> without ever exposing that key material to the application or the JavaScript
> environment.
>
> — [Web Cryptography Level 2, §5.2 "Key Storage"](https://www.w3.org/TR/WebCryptoAPI/#concepts-key-storage)

### The critical question: is a browser key a meaningful defence against anyone who can run JS on the origin?

**No. Be precise about this, because the honest answer is uncomfortable and the
common framing is wrong.**

Non-extractable means `exportKey()` and `wrapKey()` throw. That stops a script
from *reading the bytes out*. It does nothing about a script that can *ask the
key to do the job*. `key.usages` includes `decrypt` — that is the whole point of
having the key — so hostile script on the origin can call
`subtle.decrypt(key, …)` on any ciphertext it can reach in IndexedDB and read
the plaintext. It never needs the key bytes. The spec says this in its own
words:

> Conceptually, issues such as **script injection are the equivalent of remote
> code execution** in other operating environments, and allowing hostile script
> to be injected may allow for the exfiltration of keys or data.
>
> — [Web Cryptography Level 2, §6.2](https://www.w3.org/TR/WebCryptoAPI/#security-developers)

And a second, separate, and weaker boundary problem:
> This specification does not define any specific mechanisms for the storage of
> cryptographic keys. By default, unless specific effort is taken by the author
> to persist keys, such as through the use of the Indexed Database API, keys
> created with this API will only be valid for the duration of the current page
> … Authors should be aware of the security assumptions of these technologies,
> such as the same-origin security model; that is, any application that shares
> the same scheme, host, and port have access to the same storage partition
> … Authors should not presume that keys will be available indefinitely.
>
> — [Web Cryptography Level 2, §6.2](https://www.w3.org/TR/WebCryptoAPI/#security-developers)

So a non-extractable key protects against three things and no more: disk
snooping by something that reads the profile directory but does not run script;
another web origin; and accidental leakage into a backup. It does not protect
against script execution on your origin, which for a local app fed by a
hand-written SPA is a *much* more likely attack than disk snooping.

**If you want the key to be a real boundary, the key must never be in the
browser at all.** That is the entire argument for `Bun.secrets`: the decrypt
happens in the Bun process, which the page cannot reach.

The third-party consensus is more explicit still, and it names non-extractable
Web Crypto keys as the *only* acceptable browser-side pattern — which even then
is a weak place to be:
> A user (or any process running with that user's privileges, including malware)
> with read access to the browser profile directory on disk can read or modify
> the stored data, so **do not assume client-side storage provides
> confidentiality**. Do not store session tokens, credentials, or other secrets
> in IndexedDB unless they are encrypted with a key that is not itself
> recoverable from the browser (for example, derived from a user-supplied
> passphrase that is never persisted, or wrapped by a non-extractable Web Crypto
> `CryptoKey`). A single Cross-Site Scripting vulnerability can read or write any
> data in IndexedDB.
>
> — [OWASP HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)

(Cited as a consensus standard — OWASP is first-party for its own cheat sheets,
but this is not a W3C or Mozilla normative statement.)

### One practical fact, since it is easy to get wrong

`SubtleCrypto` is `[SecureContext]`-gated. **This app is fine.** The Secure
Contexts spec treats loopback as trustworthy:

> If `origin`'s host matches one of the CIDR notations `127.0.0.0/8` or
> `::1/128` [RFC4632], return "Potentially Trustworthy".
>
> — [Secure Contexts §3.1 "Is origin potentially trustworthy?"](https://w3c.github.io/webappsec-secure-contexts/#is-origin-potentially-trustworthy)

So `http://127.0.0.1:8787` is a secure context and `crypto.subtle` is available.
Do not reject this option on availability grounds. Reject it on the grounds
above.

---

## 5. `localStorage` vs IndexedDB for secrets

### MDN

I checked the current MDN `localStorage` page by full-text search for "Warning",
"private", "sensitive", "not secure", and "Do not store". **There is no
"don't store secrets here" warning on that page.** It documents `SecurityError`
conditions and the `localStorage`/`sessionStorage` expiry difference and nothing
else on this topic.
— [MDN: `Window.localStorage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)

Recording this as a genuine negative: I was expecting MDN to carry a warning
here and it does not. Do not cite MDN for that claim.

### Chrome

Chrome's guidance is scoped to extensions but the statement is unconditional:
> All requested user data should be treated with care. Store and retrieve data in
> a secure server with a registered domain. Always use HTTPS to connect and
> **avoid keeping sensitive user data in the client side of an extension as
> extension storage is not encrypted.**
>
> — [Chrome for Developers: Protect user privacy](https://developer.chrome.com/docs/extensions/develop/security-privacy/user-privacy)

And on Web Storage specifically:
> While extensions can use the `Storage` interface (accessible from
> `window.localStorage`) in some contexts (popup and other HTML pages), **we
> don't recommend it** for the following reasons: … Data saved using the Web
> Storage API is lost when the user clears their browsing history.
>
> — [Chrome for Developers: `browser.storage`](https://developer.chrome.com/docs/extensions/reference/api/storage)

### The strongest available statement

OWASP's HTML5 Security Cheat Sheet is explicit about both stores:

> A single Cross Site Scripting can be used to steal all the data in these
> objects, so again it's recommended **not to store sensitive information in
> local storage**. … Do not store session identifiers in local storage as the
> data is always accessible by JavaScript. Cookies can mitigate this risk using
> the `httpOnly` flag.
>
> — [OWASP HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)

and, for IndexedDB, the paragraph quoted in [Q4](#4-web-crypto-what-subtlecrypto-actually-gives-you)
above.

**Summary for the table:** `localStorage` fails on confidentiality, on XSS, and
on durability. IndexedDB is a strictly better *mechanism* but inherits the same
confidentiality problem, and its documented mitigation requires a key that is
not in the browser — at which point you are back to needing a server-side or OS
store, which is `Bun.secrets`.

---

## 6. Alternatives to storing the password at all

### The already-installed option

**`Bun.secrets`.** It is in the runtime, has no dependency, and is documented as
cross-platform with per-platform backends. The docs are candid about what it is
for:
> This API is mostly useful for local development tools. We may later add a
> `provider` option for production deployment secrets.
>
> — [bun.com/docs/runtime/secrets](https://bun.com/docs/runtime/secrets)

That is a description of this app.

Per-platform behaviour, from the same page:
- **macOS** — "Bun stores credentials in the user's login keychain. The keychain
  may prompt for access permission on first use. Credentials persist across
  system restarts. Accessible by the user who stored them."
- **Linux** — "Requires a secret service daemon such as GNOME Keyring or
  KWallet. Bun stores credentials in the default collection. May prompt for
  unlock if the keyring is locked."
- **Windows** — "Bun stores credentials in Windows Credential Manager. Visible in
  Control Panel → Credential Manager → Windows Credentials."

The macOS note is a real caveat: on macOS the keychain may prompt. For an
unattended auto-login that is a design consideration, not a blocker (the prompt
is on unlock, not on every read, but verify).

Linux equivalent, for the record: libsecret is "Secret Service D-Bus client
library" — [gnome.pages.gitlab.gnome.org/libsecret](https://gnome.pages.gitlab.gnome.org/libsecret/)

### `pass` (password-store)

GPG-encrypted, plaintext files, git-optional. It is a good human tool and a poor
program dependency: every call shells out to `gpg`, and you inherit GPG agent
pinentry. For a single-user local app asking for unattended auto-login, it adds
a process and a prompt where `Bun.secrets` adds neither.
— [passwordstore.org](https://www.passwordstore.org/)

### Bitwarden CLI / 1Password CLI

Both are real and both put an unlock prompt and an external binary in the path:
> `bw login` — This will initiate a prompt for your Email Address, Master
> Password, and (if enabled) at Two-step Login code.
>
> — [Bitwarden CLI help](https://bitwarden.com/help/cli/)

Reasonable if the user already runs one and wants this app's password in the
same place as everything else. Otherwise it is a large dependency for one
credential. **1Password CLI: UNVERIFIED** — I could not load
`https://developer.1password.com/docs/cli/reference/management-commands/get/`
to confirm the `op read` invocation against a primary source.

### OS-level credential autofill

Exists on macOS and iOS, does not exist for arbitrary local web apps on Windows.
Not applicable here.

### "Don't store it at all"

The most secure option, and worth saying out loud: **just make the sign-in
form's `autocomplete="username"` / `autocomplete="current-password"` correct
and let the browser's password manager remember the password.** The user types
it once, ever, and Chrome stores it under AES-256-GCM with a DPAPI-wrapped key
(§3 above) — better protection than anything this app could implement, for free,
in code we do not own or audit.

The cost is that the user types the password on each fresh session. If that is
acceptable, the correct amount of code here is two attributes, and this document
recommends nothing else.

---

## 7. `bun:sqlite` / file storage, and where an encrypted blob should live on Windows

### `bun:sqlite` has no encryption

Bun's SQLite driver is "natively implement[ed]" with transactions, prepared
statements, and BLOB↔`Uint8Array` conversion. Encryption is not in the feature
list.
— [bun.com/docs/runtime/sqlite](https://bun.com/docs/runtime/sqlite)

SQLite's own file is plaintext unless you use SEE or SQLCipher, neither of which
Bun's bundled driver documents. **UNVERIFIED**: I did not test whether Bun's
build has a bundled encryption extension.

If the database is a reasonable container for a DPAPI-encrypted blob, then: yes,
store `{ user, blob, expiresAt }` in SQLite and let the blob be opaque. But this
is strictly more machinery than `Bun.secrets` for no security gain, and it
reintroduces the file-permission question below.

### Where on Windows

**`%LOCALAPPDATA%\<app>\`.** Microsoft defines the folder:

> **FOLDERID_LocalAppData** — GUID `{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}` —
> Display Name Local — Folder Type **PERUSER** — Default Path
> **`%LOCALAPPDATA%` (`%USERPROFILE%\AppData\Local`)**
>
> — [Known Folder IDs (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/win32/shell/knownfolderid)

`PERUSER` is the point: it is the per-user, non-roaming, non-synced location.
Contrast `FOLDERID_RoamingAppData`, which is exactly the profile that makes
DPAPI blobs decryptable elsewhere.

Observed on this machine: `LOCALAPPDATA=C:\Users\manoh\AppData\Local`.

**Do not put it in the repo.** This checkout is at
`C:\Users\manoh\OneDrive\Desktop\ecap-attendance-app`. A secrets file there is
inside a OneDrive-synced folder, which means a DPAPI blob would be uploaded to
Microsoft OneDrive and would fail to decrypt on any other machine anyway. This
is a concrete, current, machine-specific reason — not a hypothetical.

### File permission realities on Windows

> If you specify `NULL` for the `lpSecurityAttributes` parameter, the file or
> directory gets a default security descriptor. **The access control lists (ACL)
> in the default security descriptor for a file or directory are inherited from
> its parent directory.** Note that a default security descriptor is assigned
> only when a file or directory is newly created, and not when it is renamed or
> moved.
>
> — [File Security and Access Rights (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights)

So the honest description of a DPAPI-wrapped file in `%LOCALAPPDATA%`:

- **Protects:** other local user accounts; an offline attacker with the file but
  not your logon session; a stolen backup or disk image.
- **Does not protect:** any process running as you. A file's ACL cannot exclude
  the user who owns it, and even a restrictive ACL on the file does not stop
  that user's process from calling `CryptUnprotectData` on the blob it just
  read. This is the same account-level boundary as §1.
- **Does not protect:** anything that syncs the folder. OneDrive lives above the
  ACL in a way that matters a great deal in this checkout.

Note the asymmetry that makes `Bun.secrets` win: a file's confidentiality is
exactly the parent directory's ACL, which you did not design and cannot
constrain against your own account. Credential Manager's confidentiality is
defined by the OS around your logon session. Same attacker, different
guarantee.

---

## Known problems (to check in issue #1)

`Bun.secrets` is the recommendation, and it is also young. These are real,
open, and worth a smoke test before shipping:

| Issue | Status |
|---|---|
| [No inter-script isolation — any bun script can read any secret](https://github.com/oven-sh/bun/issues/28071) | [open](https://github.com/oven-sh/bun/issues/28071) |
| [Windows Credential Manager calls are not serialized](https://github.com/oven-sh/bun/pull/42263) | [open](https://github.com/oven-sh/bun/pull/42263) — concurrent `get`/`set` may race |
| [No timeout or cancellation on keyring calls](https://github.com/oven-sh/bun/pull/40645) | [open](https://github.com/oven-sh/bun/pull/40645) — a hung Credential Manager call hangs the request |
| [`Bun.secrets.get` returns a NUL byte after every character on Windows](https://github.com/oven-sh/bun/issues/24135) | [open](https://github.com/oven-sh/bun/issues/24135) — a UTF-16LE decode bug; the [fix PR #26261](https://github.com/oven-sh/bun/pull/26261) is closed |
| [`persist: "local"` not in the 1.4.2 type definitions](https://github.com/oven-sh/bun/pull/42161) | [merged upstream](https://github.com/oven-sh/bun/pull/42161); presence in the local 1.4.2 runtime **UNVERIFIED** |

The NUL-byte one is the one that would actually bite: it would make the stored
password wrong, and the failure would look like "my password stopped working"
rather than an integration bug. Write a round-trip test that writes a known
string and reads it back byte-for-byte, and assert on the exact value.

---

## What we rejected and why

**DPAPI via `bun:ffi`.** Reachable — all three symbols resolve on this machine —
but Microsoft's guidance ranks Credential Manager above it for this exact data
shape, `bun:ffi` is documented experimental, and it puts `LocalFree` and
`DATA_BLOB` marshalling into our code. We would be reimplementing
`Bun.secrets`. The one thing DPAPI buys that Credential Manager does not is
arbitrary binary blobs; we have one string.

**DPAPI via a Node-API native module.** The correct-by-the-book answer, and the
docs' own recommendation over `bun:ffi`. But it means a C++ toolchain, a
`.node` binary, and a rebuild path, for a job the runtime already does.

**`bun:ffi` against `Advapi32.dll` directly.** Technically the same store as
`Bun.secrets` with more of our code in it. Kept as a documented fallback for the
one thing `Bun.secrets` may not expose — explicit `Persist =
CRED_PERSIST_LOCAL_MACHINE`.

**Web Crypto non-extractable key in IndexedDB.** Rejected on the spec's own
words: non-extractable blocks *export*, not *use*, and §6.2 says script
injection is "the equivalent of remote code execution." A script that can call
`subtle.decrypt` does not need the key bytes. Also blocked in practice: §6.2
says "do not presume that keys will be available indefinitely" — a user
clearing site data silently breaks auto-login with no error.

**A passphrase-derived key in the page.** The user would have to type a password
to get a password, on every session, defeating auto-login. And the key still
lives in the same JS realm as the ciphertext, so it defends against nothing
that Web Crypto would not have already failed to defend against.

**`localStorage` / IndexedDB in plaintext.** Plaintext, origin-wide, and
indistinguishable from a bug to the next reader. MDN currently carries no
warning about this, so the "everyone knows" instinct is not evidence.

**An encrypted file in the repo.** This checkout is inside `C:\Users\manoh\OneDrive\`.
A DPAPI blob written here syncs to OneDrive, where it is both useless (wrong
machine) and wrong (the ACL does not govern the sync).

**`bun:sqlite`.** No encryption in Bun's driver. A perfectly good container for
an opaque blob, but the blob then has to be encrypted by something, and
Credential Manager already is.

**`pass` / `bw` / `op`.** Correct tools, wrong shape for this app. Each adds an
external process, a master-secret prompt, or a GPG agent to a single-user local
utility that already has a native answer.

**Hand-rolling Chromium's two-layer scheme.** The DPAPI-wrapped AES key
protecting AES-GCM rows is the right design *for a browser storing thousands of
rows*. We store one. Reimplementing it would copy the most security-sensitive
code in Chromium for no gain.

---

## The uncomfortable summary

**If a human is typing the password, the browser's password manager already
does this better than anything we would build.** Chrome on Windows stores it
under AES-256-GCM with a DPAPI-wrapped master key in `Local State`
([`os_crypt_win.cc`](https://github.com/chromium/chromium/blob/main/components/os_crypt/async/browser/os_crypt_win.cc)),
survives site-data clears, gets a real UI, and is security-audited by a
dedicated team. All that is required of this app is two correct `autocomplete`
attributes.

**If the app signs in unattended — no human present — nothing exists in the
browser to help.** The password has to reach the Bun process, the browser is
not involved, and the OS credential store is the only thing on the machine
designed for that. That is `Bun.secrets`, already installed.

So the recommendation is a two-part answer, and the second part is optional:

1. **Add `autocomplete="username"` and `autocomplete="current-password"` to the
   sign-in form.** Costs two attributes. Let the browser remember the password
   for when the user is present.
2. **If unattended auto-login is genuinely wanted, use `Bun.secrets`** with
   `persist: "local"` where supported, store `expiresAt` as a sibling field
   checked on every read, and document plainly what it does and does not
   protect — which is exactly the honest scope of
   [oven-sh/bun#28071](https://github.com/oven-sh/bun/issues/28071): not other
   user accounts, not offline theft, not a synced folder; **not** another
   process running as the same user.
