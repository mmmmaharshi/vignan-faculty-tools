import { Paper, SimpleGrid, Text } from "@mantine/core";

import type { RegisterReply } from "../../shared/api";

type RegisterSummaryProps = {
  summary: RegisterReply["summary"];
  /** Overall means every subject in the section; subject means the chosen one. */
  scope?: "subject" | "overall";
};
type CardProps = {
  figure: React.ReactNode;
  caption: string;
  tint?: string;
};
const Card = ({ figure, caption, tint }: CardProps): React.JSX.Element => (
  <Paper withBorder p="md">
    <Text fw={700} size="xl" c={tint}>
      {figure}
    </Text>
    <Text c="dimmed" size="xs" tt="uppercase">
      {caption}
    </Text>
  </Paper>
);
export const RegisterSummary = ({
  summary,
  scope = "subject",
}: RegisterSummaryProps): React.JSX.Element => {
  const overall = scope === "overall";
  const average = overall ? summary.overallAverage : summary.average;
  const below = overall ? summary.overallIrregular : summary.irregular;
  const worst = overall ? summary.overallCritical : summary.critical;
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
      <Card figure={summary.total} caption="Students" />
      <Card
        figure={average == null ? "—" : `${average}%`}
        caption={overall ? "Overall class average" : "Class average"}
      />
      <Card
        figure={below}
        caption={`Below ${summary.irregularBelow}%${overall ? " overall" : ""}`}
        tint={below ? "yellow.8" : undefined}
      />
      <Card
        figure={worst}
        caption={`Below ${summary.criticalBelow}%${overall ? " overall" : ""}`}
        tint={worst ? "red.8" : undefined}
      />
    </SimpleGrid>
  );
};
