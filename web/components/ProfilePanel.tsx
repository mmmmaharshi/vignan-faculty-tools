import { Group, Image, Paper, Stack, Table, Text, Title } from "@mantine/core";

import type { FacultyProfile } from "../../shared/api";

export type ProfilePanelProps = {
  userId: string;
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
      <Row label="Employee Id" value={userId || "—"} />
      <Row
        label="Name (ECAP)"
        value={nameValue(faculty ?? null, busy ?? false)}
      />
      <Row
        label="Designation"
        value={designationValue(faculty ?? null, busy ?? false)}
      />
      <Title order={5} mt="sm">
        Leaves
      </Title>
      {faculty?.leaveStatus?.some((leave) => Number(leave.applied) > 0) ? (
        <Table striped withTableBorder tabularNums>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Leave</Table.Th>
              <Table.Th ta="right">Eligible</Table.Th>
              <Table.Th ta="right">Applied</Table.Th>
              <Table.Th ta="right">Approved</Table.Th>
              <Table.Th ta="right">Pending</Table.Th>
              <Table.Th ta="right">Declined</Table.Th>
              <Table.Th ta="right">Available</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {faculty.leaveStatus
              .filter((leave) => Number(leave.applied) > 0)
              .map((leave) => (
                <Table.Tr key={leave.type}>
                  <Table.Td>{leave.type}</Table.Td>
                  <Table.Td ta="right">{leave.eligible}</Table.Td>
                  <Table.Td ta="right">{leave.applied}</Table.Td>
                  <Table.Td ta="right">{leave.approved}</Table.Td>
                  <Table.Td ta="right">{leave.pending}</Table.Td>
                  <Table.Td ta="right">{leave.declined}</Table.Td>
                  <Table.Td ta="right">{leave.available}</Table.Td>
                </Table.Tr>
              ))}
          </Table.Tbody>
        </Table>
      ) : (
        <Text size="sm">{busy ? "Reading from ECAP..." : "—"}</Text>
      )}
    </Stack>
  </Paper>
);
