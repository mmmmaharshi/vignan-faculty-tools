import {
  Alert,
  Button,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

import type { CascadeLevel, Option, OptionsReply } from "../../shared/api";
import type { Level, Range, Sel } from "../cascade";
import type { Note } from "../types";

type ClassPickerProps = {
  levels: readonly (readonly [Level, string])[];
  opts: OptionsReply;
  sel: Sel;
  disabled: Record<Level, boolean>;
  range: Range;
  busy: boolean;
  loadNote: string;
  filterNote: Note | null;
  onSelect: (key: CascadeLevel, value: string) => void;
  onRange: (part: "from" | "to", value: string) => void;
  onLoad: () => void;
};
function toSelectData(list: Option[]): { value: string; label: string }[] {
  return list.map((o) => ({ value: String(o.value), label: o.label }));
}
function labelFor(
  levels: ClassPickerProps["levels"],
  key: CascadeLevel
): string {
  return levels.find(([k]) => k === key)?.[1] ?? key;
}
export const ClassPicker = ({
  levels,
  opts,
  sel,
  disabled,
  range,
  busy,
  loadNote,
  filterNote,
  onSelect,
  onRange,
  onLoad,
}: ClassPickerProps): React.JSX.Element => (
  <Paper withBorder p="lg" mb="md">
    <Stack>
      <Title order={4}>Class</Title>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {levels.map(([key, label]) => (
          <Select
            key={key}
            label={label}
            data={toSelectData(opts[key])}
            value={sel[key] || null}
            onChange={(value) => {
              if (value !== null) onSelect(key, value);
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
          onChange={(e) => onRange("from", e.currentTarget.value)}
        />
        <TextInput
          label="To"
          type="date"
          value={range.to}
          onChange={(e) => onRange("to", e.currentTarget.value)}
        />
      </SimpleGrid>
      <Group>
        <Button onClick={onLoad} loading={busy}>
          Load register
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
      {opts.emptyLevels.length > 0 && (
        <Alert color="yellow">
          ECAP returned no{" "}
          {opts.emptyLevels.map((k) => labelFor(levels, k)).join(" or ")} for
          this combination. Either the portal&apos;s layout has changed, or this
          branch does not run in this semester. Other levels are unaffected.
        </Alert>
      )}
    </Stack>
  </Paper>
);
