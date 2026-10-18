import {
  Divider,
  Group,
  Image,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";

import type { FacultyProfile } from "../../shared/api";

export type ProfilePanelProps = {
  userId: string;
  persisted: boolean;
  /** ECAP's own details for the signed-in faculty member, read once when the
   *  panel opens. Null while loading or when ECAP did not provide them. */
  faculty?: FacultyProfile | null;
  busy?: boolean;
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
const designationLabel = (code: string): string => {
  if (code === "0") return "Faculty";
  if (code === "-1" || code === "") return "Not available from ECAP";
  return `HOD / designation ${code}`;
};
const nameValue = (
  faculty: FacultyProfile | null | undefined,
  busy: boolean
): string => {
  if (faculty?.name) return faculty.name;
  if (busy) return "Reading from ECAP...";
  return "—";
};
const designationValue = (
  faculty: FacultyProfile | null | undefined,
  busy: boolean
): string => {
  if (faculty) return designationLabel(faculty.designation);
  if (busy) return "Reading from ECAP...";
  return "—";
};
export const ProfilePanel = ({
  userId,
  persisted,
  faculty,
  busy,
}: ProfilePanelProps): React.JSX.Element => (
  <Paper withBorder p="lg">
    <Stack gap="xs">
      <Title order={4}>Profile</Title>
      {faculty?.photo ? (
        <Group>
          <Image
            src={faculty.photo}
            alt={faculty.name || userId}
            w={96}
            h={96}
            radius="md"
            fit="cover"
          />
        </Group>
      ) : null}
      <Row label="ECAP user name" value={userId || "—"} />
      <Row
        label="Name (ECAP)"
        value={nameValue(faculty ?? null, busy ?? false)}
      />
      <Row
        label="Designation"
        value={designationValue(faculty ?? null, busy ?? false)}
      />
      <Divider my="xs" />
      <Row
        label="Session"
        value={
          persisted
            ? "Kept in the server's credential vault, so restarting the server keeps you signed in."
            : "In memory only, so restarting the server signs you out."
        }
      />
      <Row
        label="Your password"
        value="Kept in the server's credential vault (the OS vault in production, a plaintext dev file otherwise), so the app can sign you back in when ECAP times the session out. Never sent to the browser or logged."
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
