import { Button, Group, Paper, SimpleGrid, Text, Title } from "@mantine/core";
import { ArrowCounterClockwise, Trash } from "@phosphor-icons/react";
import React from "react";

import type { Sel } from "../cascade";

/**
 * The saved classes, as cards above the class form. Opening one fills the four
 * section levels and nothing else: no register is read, here or anywhere else on
 * this screen. A saved class is a Section and nothing more, so the card names
 * that section and lets the cascade settle the Subject as usual.
 */
export const SavedClasses = ({
  classes,
  onOpen,
  onForget,
}: {
  classes: readonly { sel: Sel; name: string }[];
  onOpen: (sel: Sel) => void;
  onForget: (sel: Sel) => void;
}): React.JSX.Element | null => {
  if (!classes.length) return null;
  return (
    <>
      <Title order={5} mb="xs">
        Saved classes
      </Title>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} mb="md">
        {classes.map(({ sel, name }) => (
          <Paper key={name} withBorder p="md">
            <Text size="xs" c="dimmed" tt="uppercase">
              Opens this section
            </Text>
            <Text fw={700}>{name}</Text>
            <Group gap="xs" mt="sm">
              <Button
                size="xs"
                variant="light"
                onClick={() => onOpen(sel)}
                leftSection={<ArrowCounterClockwise size={16} aria-hidden />}
              >
                Open
              </Button>
              <Button
                size="xs"
                variant="subtle"
                color="red"
                onClick={() => onForget(sel)}
                leftSection={<Trash size={16} aria-hidden />}
              >
                Forget
              </Button>
            </Group>
          </Paper>
        ))}
      </SimpleGrid>
    </>
  );
};
