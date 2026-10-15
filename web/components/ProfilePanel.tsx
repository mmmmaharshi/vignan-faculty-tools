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
        value="Kept in the OS credential vault, so the app can sign you back in when ECAP times the session out. Never sent to the browser or logged."
      />
      <Row
        label="What is stored"
        value="The ECAP session token and your sign-in credential. Sign out deletes both."
      />
      <Divider my="xs" />
      <Text size="sm">
        ECAP ends a session after about twenty minutes of inactivity. When it
        does, this app signs in again with the stored credential, so a break
        does not send you back to the form.
      </Text>
    </Stack>
  </Paper>
);
