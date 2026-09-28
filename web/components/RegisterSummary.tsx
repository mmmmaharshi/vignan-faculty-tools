import { Paper, SimpleGrid, Text } from "@mantine/core";

import type { RegisterReply } from "../../shared/api";

type RegisterSummaryProps = {
  summary: RegisterReply["summary"];
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
}: RegisterSummaryProps): React.JSX.Element => (
  <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
    <Card figure={summary.total} caption="Students" />
    <Card
      figure={summary.average == null ? "—" : `${summary.average}%`}
      caption="Class average"
    />
    <Card
      figure={summary.irregular}
      caption={`Below ${summary.irregularBelow}%`}
      tint={summary.irregular ? "yellow.8" : undefined}
    />
    <Card
      figure={summary.critical}
      caption={`Below ${summary.criticalBelow}%`}
      tint={summary.critical ? "red.8" : undefined}
    />
  </SimpleGrid>
);
