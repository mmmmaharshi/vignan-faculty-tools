/**
 * ECAP Attendance Dashboard - front end
 *
 * React 19 + Mantine 9. There is no custom CSS in this project: not a
 * stylesheet, not a CSS module, not an inline `style` prop. Every visual
 * decision is a Mantine component or a Mantine colour token, read through
 * Mantine's own `bg` and `c` props. The row tint on the register table is
 * Mantine's `Table.Tr bg`, pointed at `--mantine-color-*-light`.
 *
 * The cascade below is a deliberate line-for-line port of the imperative
 * version, not a redesign. It was wrong three separate times before it was
 * right, and the mistakes it is guarding against are structural, not stylistic:
 *
 *   - /api/session answers 200 with {signedIn:false}, not 401. Checking the
 *     status code alone runs the signed-in path while signed out.
 *   - Two refreshes can overlap. refreshToken makes the newer call win, so a
 *     stale response can never repopulate the dropdowns.
 *   - Auto-advance only when a level has exactly ONE option, because there is
 *     then no decision to get wrong. With several, stop and let the user pick:
 *     silently choosing one of three sections risks loading the wrong class.
 *
 * See docs/adr/0001-port-ui-to-react-and-mantine.md.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Container,
  Divider,
  Group,
  Paper,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

const IRREGULAR_BELOW = 75;
const CRITICAL_BELOW = 60;

/** The full chain, in cascade order. */
const LEVELS = [
  ["course", "Course"],
  ["semester", "Semester"],
  ["branch", "Branch"],
  ["section", "Section"],
  ["subject", "Subject"],
];
const LEVEL_KEYS = LEVELS.map(([k]) => k);

/**
 * Levels the app may choose on the user's behalf. The subject is excluded: it
 * is the choice that matters, and guessing it would risk the wrong register.
 */
const AUTO_KEYS = ["course", "semester", "branch", "section"];

const EMPTY_SEL = Object.fromEntries(LEVEL_KEYS.map((k) => [k, ""]));
const EMPTY_OPTS = Object.fromEntries(LEVEL_KEYS.map((k) => [k, []]));

/* ------------------------------------------------------------------ helpers */

async function api(path, options) {
  const res = await fetch(path, options);
  let body = {};
  try {
    body = await res.json();
  } catch {
    /* an empty body is not fatal here */
  }
  if (!res.ok) {
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

/** The portal wants dd/mm/yyyy. */
function toPortalDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function defaultRange() {
  const now = new Date();
  return {
    to: now.toISOString().slice(0, 10),
    from: new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10),
  };
}

/**
 * Merge a fresh option set into the current selection.
 *
 * This reproduces what a browser did to the old <select> elements: a value that
 * is still a valid option survives, and anything else falls to the first option,
 * because a populated select always has something selected.
 *
 * The subject is the exception. It is the choice that matters, and quietly
 * pre-selecting the first one risks loading the wrong register, so it is left
 * empty for the user to pick.
 */
function applyOptions(sel, opts) {
  const next = { ...sel };
  for (const key of LEVEL_KEYS) {
    if (key === "subject") {
      next.subject = "";
      continue;
    }
    const list = opts[key] ?? [];
    if (!list.length) {
      next[key] = "";
      continue;
    }
    if (!list.some((o) => String(o.value) === String(next[key]))) {
      next[key] = list[0].value;
    }
  }
  return next;
}

function toSelectData(list) {
  return (list ?? []).map((o) => ({ value: String(o.value), label: o.label }));
}

/**
 * Whether every level above `key` has a choice, i.e. whether the server could
 * now answer for it.
 */
function isReady(sel, key) {
  const i = LEVEL_KEYS.indexOf(key);
  return LEVEL_KEYS.slice(0, i).every((k) => !!sel[k]);
}

/* ------------------------------------------------------------------ app */

export default function App() {
  const [phase, setPhase] = useState("boot"); // boot | login | app
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");

  const [loginNote, setLoginNote] = useState(null);
  const [filterNote, setFilterNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadNote, setLoadNote] = useState("");

  const [sel, setSel] = useState(EMPTY_SEL);
  const [opts, setOpts] = useState(EMPTY_OPTS);

  const [range, setRange] = useState(() => defaultRange());
  const [result, setResult] = useState(null);
  const [onlyIrregular, setOnlyIrregular] = useState(false);

  // The cascade is driven imperatively, not from an effect watching `sel`.
  // A state-driven effect would re-enter itself every time it committed a pass.
  const selRef = useRef(sel);
  selRef.current = sel;
  const refreshToken = useRef(0);

  /* ---- the cascade ---- */

  const runRefresh = useCallback(async (changed) => {
    const token = ++refreshToken.current;

    // Drop everything below the level that changed *before* asking, so the
    // request only ever carries a valid prefix of the chain. A stale semester
    // left in place would make the server compute a section list for a
    // combination the user can no longer see.
    let sel = { ...selRef.current };
    if (changed === "course") {
      sel = { ...sel, semester: "", branch: "", section: "", subject: "" };
    } else if (changed === "semester" || changed === "branch") {
      sel = { ...sel, section: "", subject: "" };
    } else if (changed === "section") {
      sel = { ...sel, subject: "" };
    }
    selRef.current = sel;
    setSel(sel);

    setBusy(true);
    setLoadNote("Loading options...");

    try {
      for (let pass = 0; pass < LEVEL_KEYS.length; pass++) {
        if (token !== refreshToken.current) return;

        const opts = await api("/api/options", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            course: sel.course || undefined,
            semester: sel.semester || undefined,
            branch: sel.branch || undefined,
            section: sel.section || undefined,
          }),
        });
        if (token !== refreshToken.current) return;

        const before = sel;
        const next = applyOptions(sel, opts);
        sel = next;
        selRef.current = next;
        setSel(next);
        setOpts(opts);

        // Keep going while this pass settled a level AND some level below it is
        // now ready but still empty.
        //
        // The tempting shortcut - stop as soon as a level has more than one
        // option, because the user ought to choose - dead-ends the chain.
        // Changing a branch clears section and subject, so the request goes out
        // with no section and the server answers with no subjects; applyOptions
        // then fills section to its only option and nothing ever asks again. If
        // that section has just the one option the user cannot change it, so
        // the subject list becomes unreachable.
        //
        // Populating the whole chain and letting the user override any level is
        // both simpler and what a user expects. Requiring `gained` stops this
        // looping when the server genuinely has nothing to give.
        const gained = LEVEL_KEYS.some((k) => sel[k] !== before[k]);
        const pending = LEVEL_KEYS.find(
          (k) => k !== "course" && isReady(sel, k) && (opts[k] ?? []).length === 0,
        );
        if (!gained || !pending) return;
      }
    } catch (err) {
      if (err.status === 401) {
        setPhase("login");
        return;
      }
      setFilterNote({ kind: "error", text: err.message });
    } finally {
      if (token === refreshToken.current) {
        setBusy(false);
        setLoadNote("");
      }
    }
  }, []);

  /* ---- sign in ---- */

  const signIn = async (e) => {
    e.preventDefault();
    setLoginNote(null);
    setBusy(true);
    try {
      await api("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: userId.trim(), password }),
      });
      setPassword(""); // do not keep it in the DOM
      setPhase("app");
      await runRefresh(null);
    } catch (err) {
      setLoginNote({ kind: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    try {
      await api("/api/logout", { method: "POST" });
    } catch {
      /* the cookie is cleared either way */
    }
    setPhase("login");
    setSel(EMPTY_SEL);
    setOpts(EMPTY_OPTS);
    setResult(null);
  };

  // Resume: the endpoint answers 200 with {signedIn:false} when signed out,
  // so the check has to be on the payload, not the status.
  useEffect(() => {
    (async () => {
      try {
        const s = await api("/api/session");
        if (s && s.signedIn) {
          setPhase("app");
          await runRefresh(null);
        } else {
          setPhase("login");
        }
      } catch {
        setPhase("login");
      }
    })();
  }, [runRefresh]);

  /* ---- register ---- */

  const loadRegister = async () => {
    setFilterNote(null);
    if (!sel.subject) {
      setFilterNote({ kind: "warning", text: "Choose a subject first." });
      return;
    }
    if (!range.from || !range.to) {
      setFilterNote({ kind: "warning", text: "Choose a date range." });
      return;
    }

    setBusy(true);
    setLoadNote("Reading the register from ECAP...");
    try {
      const body = await api("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          course: sel.course || undefined,
          semester: sel.semester,
          branch: sel.branch || undefined,
          section: sel.section || undefined,
          subject: sel.subject,
          from: toPortalDate(range.from),
          to: toPortalDate(range.to),
        }),
      });
      setResult(body);
    } catch (err) {
      if (err.status === 401) {
        setPhase("login");
        return;
      }
      setFilterNote({ kind: "error", text: err.message });
    } finally {
      setBusy(false);
      setLoadNote("");
    }
  };

  /* ---- export ---- */

  const saveCsv = () => {
    if (!result) return;
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const head = ["Roll No", "Student Name", "Attend/Held", "Percent", "Status"];
    const lines = [head.map(q).join(",")];
    for (const s of result.students) {
      const status = s.critical ? "Critical" : s.irregular ? "Irregular" : "Regular";
      lines.push(
        [s.roll, s.name, s.held, s.pct == null ? "" : s.pct.toFixed(2), status]
          .map(q)
          .join(","),
      );
    }
    // The BOM is what makes Excel read the file as UTF-8.
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ecap-attendance.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  };

  /* ---- derived ---- */

  const has = (k) => !!sel[k];
  const disabled = {
    course: false,
    semester: !has("course"),
    branch: !has("course"),
    section: !(has("course") && has("branch") && has("semester")),
    subject: !(has("course") && has("branch") && has("semester") && has("section")),
  };

  const summary = result?.summary;
  const rows = result
    ? [...result.students]
        .filter((s) => !onlyIrregular || s.irregular)
        .sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999))
    : [];

  const chosenText = LEVELS.map(([key, label]) => {
    const list = opts[key] ?? [];
    const hit = list.find((o) => String(o.value) === String(sel[key]));
    return hit ? `${label}: ${hit.label}` : null;
  })
    .filter(Boolean)
    .join("   ·   ");

  /* ---- render ---- */

  return (
    <Container size="lg" py="lg">
      <Group justify="space-between" align="baseline" mb="lg">
        <div>
          <Title order={1}>ECAP Attendance Dashboard</Title>
          <Text c="dimmed" size="sm">
            Vignan Institute of Technology
          </Text>
        </div>
        <Group gap="sm">
          {phase === "app" && userId.trim() && (
            <Text c="dimmed" size="sm">
              {userId.trim()}
            </Text>
          )}
          {phase === "app" && (
            <Button variant="default" onClick={signOut}>
              Sign out
            </Button>
          )}
        </Group>
      </Group>

      {phase !== "app" && (
        <Paper withBorder p="lg" mb="md">
          <form onSubmit={signIn}>
            <Stack>
              <Title order={4}>Sign in</Title>
              <Group grow align="flex-end">
                <TextInput
                  label="ECAP user name"
                  value={userId}
                  onChange={(e) => setUserId(e.currentTarget.value)}
                  autoComplete="username"
                  required
                />
                <PasswordInput
                  label="Password"
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  autoComplete="current-password"
                  required
                />
                <Button type="submit" loading={busy} fullWidth>
                  Sign in
                </Button>
              </Group>
              {loginNote ? (
                <Alert color={loginNote.kind === "error" ? "red" : "yellow"}>
                  {loginNote.text}
                </Alert>
              ) : (
                <Alert color="blue">
                  Your credentials are used once to sign in and are never stored by this
                  app. Signing in opens a session that stays active for up to 12 hours.
                </Alert>
              )}
            </Stack>
          </form>
        </Paper>
      )}

      {phase === "app" && (
        <>
          <Paper withBorder p="lg" mb="md">
            <Stack>
              <Title order={4}>Class</Title>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
                {LEVELS.map(([key, label]) => (
                  <Select
                    key={key}
                    label={label}
                    data={toSelectData(opts[key])}
                    value={sel[key] || null}
                    onChange={(value) => {
                      const v = value ?? "";
                      setSel((s) => ({ ...s, [key]: v }));
                      selRef.current = { ...selRef.current, [key]: v };
                      // Subject is filled by the server, not by a change handler.
                      if (key !== "subject") runRefresh(key);
                    }}
                    disabled={disabled[key]}
                    searchable={false}
                    allowDeselect={false}
                  />
                ))}
                <TextInput
                  label="From"
                  type="date"
                  value={range.from}
                  onChange={(e) => {
                    // Read the value here, not inside the updater: React clears
                    // event.currentTarget once the handler returns, and the
                    // updater runs later, so deferring the read throws
                    // "Cannot read properties of null".
                    const v = e.currentTarget.value;
                    setRange((r) => ({ ...r, from: v }));
                  }}
                />
                <TextInput
                  label="To"
                  type="date"
                  value={range.to}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    setRange((r) => ({ ...r, to: v }));
                  }}
                />
              </SimpleGrid>
              <Group>
                <Button onClick={loadRegister} loading={busy}>
                  Load register
                </Button>
                <Button variant="default" onClick={saveCsv} disabled={!result}>
                  Save CSV
                </Button>
                {loadNote && (
                  <Text c="dimmed" size="sm">
                    {loadNote}
                  </Text>
                )}
              </Group>
              {filterNote && (
                <Alert color={filterNote.kind === "error" ? "red" : "yellow"}>
                  {filterNote.text}
                </Alert>
              )}
            </Stack>
          </Paper>

          {summary && (
            <>
              <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
                <Paper withBorder p="md">
                  <Text fw={700} size="xl">
                    {summary.total}
                  </Text>
                  <Text c="dimmed" size="xs" tt="uppercase">
                    Students
                  </Text>
                </Paper>
                <Paper withBorder p="md">
                  <Text fw={700} size="xl">
                    {summary.average == null ? "—" : `${summary.average}%`}
                  </Text>
                  <Text c="dimmed" size="xs" tt="uppercase">
                    Class average
                  </Text>
                </Paper>
                <Paper withBorder p="md">
                  <Text
                    fw={700}
                    size="xl"
                    c={summary.irregular ? "yellow.8" : undefined}
                  >
                    {summary.irregular}
                  </Text>
                  <Text c="dimmed" size="xs" tt="uppercase">
                    Below {IRREGULAR_BELOW}%
                  </Text>
                </Paper>
                <Paper withBorder p="md">
                  <Text fw={700} size="xl" c={summary.critical ? "red.8" : undefined}>
                    {summary.critical}
                  </Text>
                  <Text c="dimmed" size="xs" tt="uppercase">
                    Below {CRITICAL_BELOW}%
                  </Text>
                </Paper>
              </SimpleGrid>

              <Paper withBorder p="lg">
                <Group justify="space-between" mb="sm">
                  <Checkbox
                    label="Show only irregular students"
                    checked={onlyIrregular}
                    onChange={(e) => setOnlyIrregular(e.currentTarget.checked)}
                  />
                </Group>

                {/*
                  Name the register on screen. With five dropdowns in front of
                  you it is easy to read last week's numbers as this week's.
                */}
                {chosenText && (
                  <>
                    <Text c="dimmed" size="sm" mb="sm">
                      {chosenText}
                      {summary.range?.from
                        ? `   ·   ${summary.range.from} to ${summary.range.to}`
                        : ""}
                    </Text>
                    <Divider mb="sm" />
                  </>
                )}

                {rows.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    {onlyIrregular
                      ? `No irregular students. Everyone is at or above ${IRREGULAR_BELOW}%.`
                      : "No students in this register."}
                  </Text>
                ) : (
                  <>
                    <Table.ScrollContainer minWidth={640}>
                      <Table striped highlightOnHover withTableBorder tabularNums>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Sl.No</Table.Th>
                            <Table.Th>Roll No</Table.Th>
                            <Table.Th>Student Name</Table.Th>
                            <Table.Th ta="right">Attend / Held</Table.Th>
                            <Table.Th ta="right">%</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {rows.map((s) => (
                            <Table.Tr
                              key={s.roll}
                              // Mantine's own `bg` prop, reading its own colour
                              // tokens. No custom CSS anywhere in this file.
                              bg={
                                s.critical
                                  ? "var(--mantine-color-red-light)"
                                  : s.irregular
                                    ? "var(--mantine-color-yellow-light)"
                                    : undefined
                              }
                            >
                              <Table.Td c="dimmed">{s.sl}</Table.Td>
                              <Table.Td>
                                <Text ff="monospace" size="sm">
                                  {s.roll}
                                </Text>
                              </Table.Td>
                              <Table.Td>
                                <Text tt="uppercase" size="sm">
                                  {s.name}
                                </Text>
                              </Table.Td>
                              <Table.Td ta="right">{s.held}</Table.Td>
                              <Table.Td ta="right">
                                {s.pct == null ? (
                                  "—"
                                ) : (
                                  <Group gap={6} justify="flex-end" wrap="nowrap">
                                    <Text fw={700} size="sm">
                                      {s.pct.toFixed(2)}%
                                    </Text>
                                    {s.critical && (
                                      <Badge color="red" size="xs" variant="light">
                                        critical
                                      </Badge>
                                    )}
                                    {!s.critical && s.irregular && (
                                      <Badge color="yellow" size="xs" variant="light">
                                        low
                                      </Badge>
                                    )}
                                  </Group>
                                )}
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Table.ScrollContainer>
                    <Text c="dimmed" size="sm" mt="sm">
                      Showing {rows.length} of {result.students.length} students, lowest
                      attendance first.
                    </Text>
                  </>
                )}
              </Paper>
            </>
          )}
        </>
      )}
    </Container>
  );
}
