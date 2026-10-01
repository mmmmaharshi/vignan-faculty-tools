import { Button, Group, Paper, SimpleGrid, Text, Title } from "@mantine/core";
import { ArrowCounterClockwise, Trash } from "@phosphor-icons/react";
import React from "react";

import type { Sel } from "../cascade";

/**
 * One saved class. The Subject leads because that is what tells one card from
 * another in the same section; the Section and the course sit beneath it as
 * context, which is also the order they matter in — you pick a subject, and the
 * section it belongs to is what identifies it.
 */
export type SavedClassCard = {
  sel: Sel;
  /** The subject's own name, falling back to its value if ECAP no longer offers it. */
  subject: string;
  sectionName: string;
  /** Course, semester and branch on one line — the longest string, so it is quietest. */
  course: string;
};
/**
 * The saved classes, as cards above the class form. Opening one fills all five
 * levels and reads no register: the card is a shortcut to the form, not a request.
 */
export const SavedClasses = ({
  classes,
  onOpen,
  onForget,
}: {
  classes: readonly SavedClassCard[];
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
        {classes.map(({ sel, subject, sectionName, course }) => (
          // The five levels are the card's identity, so the key is the values and
          // not the label text: two cards never share one.
          <Paper
            key={`${sel.course}/${sel.section}/${sel.subject}`}
            withBorder
            p="md"
          >
            <Text size="xs" c="dimmed" tt="uppercase">
              Subject
            </Text>
            <Text fw={700} size="lg" lineClamp={2}>
              {subject}
            </Text>
            <Text size="sm" c="dimmed" mt={2}>
              Section {sectionName}
            </Text>
            {course ? (
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
