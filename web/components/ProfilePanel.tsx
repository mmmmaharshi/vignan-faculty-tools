import { Divider, Paper, Stack, Text, Title } from "@mantine/core";

/**
 * What this app knows about the signed-in user.
 *
 * ## Why this is thin, and why that is not a gap in the work
 *
 * The obvious profile is a name, a department, a list of subjects taught. **ECAP
 * never gives us any of it.** `Portal.signIn` posts the user name and then checks
 * one thing — that an `frmAuth` cookie appeared — and returns. The portal's own
 * sign-in page renders a name, but nothing here reads it, and there is no call
 * that returns one: `PortalReader` is five reads about the cascade and a register,
 * and a user profile is not among them.
 *
 * So this panel shows the account id the user typed and the facts about their own
 * session that this app is genuinely authoritative about. That is thin, and
 * pretending otherwise by inventing a name from the user name would be worse: a
 * wrong name on a faculty member's own screen is the kind of thing that makes the
 * rest of the app untrustworthy.
 *
 * If a real profile is wanted, the first step is a spike: sign in against the live
 * portal and find whether any reply carries a display name. Until that is measured
 * rather than assumed, the honest panel is the one below.
 */
export type ProfilePanelProps = {
  /** The ECAP user name this session signed in with. */
  userId: string;
  /**
   * Whether the vault is holding this session, so a restart keeps it.
   *
   * Sent by the server rather than assumed by this panel: on a runtime without
   * `Bun.secrets` the sessions are in memory only, and telling a user their sign-in
   * "survives a restart" when it does not is the kind of claim that loses trust in
   * every other claim on the screen.
   */
  persisted: boolean;
};

const Row = ({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.JSX.Element => (
  <>
    <Text size="xs" tt="uppercase" c="dimmed">
      {label}
    </Text>
    <Text size="sm" mb="sm">
      {value}
    </Text>
  </>
);

export const ProfilePanel = ({
  userId,
  persisted,
}: ProfilePanelProps): React.JSX.Element => (
  <Paper withBorder p="lg">
    <Stack gap="xs">
      <Title order={4}>Profile</Title>

      <Row label="ECAP user name" value={userId || "—"} />

      <Divider my="xs" />

      <Row
        label="Session"
        value={
          persisted
            ? "Kept in the OS credential vault, so restarting the server keeps you signed in."
            : "In memory only, so restarting the server signs you out."
        }
      />
      <Row
        label="Your password"
        value="Used once to sign in, then discarded. It is never written to disk by this app."
      />
      <Row
        label="What is stored"
        value="ECAP's own session token, and nothing else. Sign out deletes it."
      />

      <Divider my="xs" />

      <Text size="sm">
        ECAP&apos;s session lasts about twenty minutes of inactivity, so you
        will be asked to sign in again after a break. That is the portal&apos;s
        limit, not this app&apos;s.
      </Text>
    </Stack>
  </Paper>
);
