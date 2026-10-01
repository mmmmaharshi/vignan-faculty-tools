import { Button, Group, Paper, Text, Title } from "@mantine/core";
import { ArrowCounterClockwise, Trash } from "@phosphor-icons/react";
import React from "react";

/**
 * The saved class, as a card above the class form. Opening it fills the four
 * section levels and nothing else: no register is read, here or anywhere else on
 * this screen. A saved class is a Section and nothing more, so the card names
 * that section and lets the cascade settle the Subject as usual.
 */
export const SavedClass = ({
  name,
  onOpen,
  onForget,
}: {
  /** The saved section's own name, rebuilt from the cascade's labels. */
  name: string;
  onOpen: () => void;
  onForget: () => void;
}): React.JSX.Element => (
  <>
    <Title order={5} mb="xs">
      Saved class
    </Title>
    <Paper withBorder p="md" mb="md">
      <Text size="xs" c="dimmed" tt="uppercase">
        Opens this section
      </Text>
      <Text fw={700} size="lg">
        {name}
      </Text>
      <Group gap="xs" mt="sm">
        <Button
          size="xs"
          variant="light"
          onClick={onOpen}
          leftSection={<ArrowCounterClockwise size={16} aria-hidden />}
        >
          Open
        </Button>
        <Button
          size="xs"
          variant="subtle"
          color="red"
          onClick={onForget}
          leftSection={<Trash size={16} aria-hidden />}
        >
          Forget
        </Button>
      </Group>
    </Paper>
  </>
);
