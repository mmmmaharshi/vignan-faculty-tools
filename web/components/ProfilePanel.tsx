import { Divider, Paper, Stack, Text, Title } from "@mantine/core";

export type ProfilePanelProps = {
  userId: string;
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
