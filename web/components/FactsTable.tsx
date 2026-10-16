import { Table, Text } from "@mantine/core";

import type { ChosenFact } from "../cascade";

/** The register's own naming — course through period, one fact per row. Shared
 *  by the card above the register and a student's panel, so the two cannot
 *  disagree about which register is on screen; exported for the same reason as
 *  `badgeFor`. It stays headless on purpose: the specs count register rows as
 *  `thead ~ tbody tr`, and a thead here would join that count. */
export const FactsTable = ({
  facts,
}: {
  facts: ChosenFact[];
}): React.JSX.Element => {
  // Two facts per row, in order: course with semester, branch with section,
  // subject with period. A dangling last fact keeps its row's shape with an
  // empty cell beside it.
  const rows: ChosenFact[][] = [];
  for (const [i, fact] of facts.entries()) {
    if (i % 2 === 0) rows.push([fact]);
    else rows.at(-1)?.push(fact);
  }
  return (
    <Table striped withTableBorder tabularNums>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={row.map((fact) => fact.label).join("+")}>
            {row.map((fact) => (
              <Table.Td key={fact.label}>
                <Text size="sm" c="dimmed">
                  {fact.label}
                </Text>
                <Text size="sm" fw={600}>
                  {fact.value}
                </Text>
              </Table.Td>
            ))}
            {row.length === 1 ? <Table.Td key="pad" /> : null}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
};
