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
import type { Disabled, Note, Range, Sel } from "../types";

/**
 * The cascade: five dependent dropdowns, a date range, and the two buttons.
 *
 * A mode `App` composes, not a component that owns the cascade. It is handed the
 * selection, the options, and which levels are enabled, and it reports changes
 * upwards. `runRefresh` - the loop that actually populates the chain - stays in
 * `App`, because it is load-bearing and documented in ADR 0001, and moving it
 * into a presentational component would put that logic somewhere a reader would
 * not look for it.
 */

type ClassPickerProps = {
  /** The level key and its visible label, in cascade order. */
  levels: readonly (readonly [CascadeLevel, string])[];
  opts: OptionsReply;
  sel: Sel;
  disabled: Disabled;
  range: Range;
  busy: boolean;
  hasResult: boolean;
  loadNote: string;
  filterNote: Note | null;
  onSelect: (key: CascadeLevel, value: string) => void;
  onRange: (part: "from" | "to", value: string) => void;
  onLoad: () => void;
  onSaveCsv: () => void;
};

/** Mantine wants `{value, label}` pairs; the portal's own Option has a title too. */
function toSelectData(list: Option[]): { value: string; label: string }[] {
  return list.map((o) => ({ value: String(o.value), label: o.label }));
}

/** "Section", "Subject" - the readable name of a level, for the warning text. */
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
  hasResult,
  loadNote,
  filterNote,
  onSelect,
  onRange,
  onLoad,
  onSaveCsv,
}: ClassPickerProps): React.JSX.Element => (
  <Paper withBorder p="lg" mb="md">
    <Stack>
      <Title order={4}>Class</Title>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        {levels.map(([key, label]) => (
          <Select
            key={key}
            label={label}
            data={toSelectData(opts[key])}
            value={sel[key] || null}
            onChange={(value) => {
              // Mantine types this as `string | null`. `allowDeselect={false}`
              // below means null should not arrive, but a default of `= ""`
              // would not catch it either - defaults only replace `undefined`.
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
        <Button variant="default" onClick={onSaveCsv} disabled={!hasResult}>
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
