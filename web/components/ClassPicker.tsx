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
  /** Retries the failed options read from scratch. Present only while an
   *  options error sits on screen: with no course there is no level to change,
   *  so without this the picker sits in its error until a reload. */
  onRetryOptions?: () => void;
  /** Rendered at the far end of the button row, so the class's own actions sit
   *  on the same line as Load register rather than under it. */
  trailing?: React.ReactNode;
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
  onRetryOptions,
  trailing,
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
            disabled={disabled[key] || busy}
            searchable={false}
            allowDeselect={false}
          />
        ))}
        <TextInput
          label="From"
          type="date"
          value={range.from}
          disabled={busy}
          onChange={(e) => onRange("from", e.currentTarget.value)}
        />
        <TextInput
          label="To"
          type="date"
          value={range.to}
          disabled={busy}
          onChange={(e) => onRange("to", e.currentTarget.value)}
        />
      </SimpleGrid>
      <Group justify="space-between">
        <Group gap="sm">
          <Button onClick={onLoad} loading={busy}>
            Load register
          </Button>
          {loadNote && (
            <Text c="dimmed" size="sm">
              {loadNote}
            </Text>
          )}
        </Group>
        {trailing}
      </Group>
      {filterNote && (
        <Alert color={filterNote.kind === "error" ? "red" : "yellow"}>
          {filterNote.text}
        </Alert>
      )}
      {onRetryOptions && (
        <Button onClick={onRetryOptions} variant="default" loading={busy}>
          Try again
        </Button>
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
