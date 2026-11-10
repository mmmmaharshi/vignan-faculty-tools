import { Button, Group, Paper, SimpleGrid, Text, Title } from "@mantine/core";
import { ArrowCounterClockwise, Trash } from "@phosphor-icons/react";
import React from "react";

import type { Sel } from "../register/cascade";
import { selKeyOf } from "../register/cascade";
import type { SavedSectionCard } from "../register/saved-sections";

/**
 * The saved sections, as cards above the class form. Opening one fills the four
 * levels and lands on the section-wide register: the card is a shortcut to the
 * form, not a request.
 */
export const SavedSections = ({
  classes,
  onOpen,
  onForget,
}: {
  classes: readonly SavedSectionCard[];
  onOpen: (sel: Sel) => void;
  onForget: (sel: Sel) => void;
}): React.JSX.Element | null => {
  if (!classes.length) return null;
  return (
    <>
      <Title order={5} mb="xs">
        Saved sections
      </Title>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} mb="md">
        {classes.map(({ sel, sectionName, course }) => (
          // The card's identity is the section it names, read through the one
          // key builder that defines it, so two cards never share a key.
          <Paper
            key={selKeyOf(sel)}
            withBorder
            p="md"
            // Equal height, so a long branch name does not leave a short card with
            // a gap under it. The name itself wraps rather than being cut.
            h="100%"
          >
            <Text size="xs" c="dimmed" tt="uppercase">
              Section
            </Text>
            <Text fw={700} size="lg">
              {/* The Portal's own section label already reads "Section-A", so a
                  "Section" prefix in front of it printed the word twice. */}
              {sectionName}
            </Text>
            {course ? (
              // Wraps rather than truncates: the branch name is the Portal's own
              // and cutting it — with an ellipsis or without — makes the card name
              // a branch it is not. A short name never wraps, so this costs
              // nothing for the cards that already fitted.
              <Text size="xs" c="dimmed">
                {course}
              </Text>
            ) : null}
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
