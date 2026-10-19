import {
  Alert,
  Button,
  Group,
  Paper,
  PasswordInput,
  SimpleGrid,
  Stack,
  TextInput,
  Title,
} from "@mantine/core";
import type { FormEvent } from "react";

import type { Note } from "../types";

type SignInPanelProps = {
  userId: string;
  password: string;
  busy: boolean;
  note: Note | null;
  onUserId: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};
export const SignInPanel = ({
  userId,
  password,
  busy,
  note,
  onUserId,
  onPassword,
  onSubmit,
}: SignInPanelProps): React.JSX.Element => (
  <Paper withBorder p="lg" mb="md">
    <form onSubmit={onSubmit}>
      <Stack>
        <Title order={4}>Sign in</Title>
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          <TextInput
            label="ECAP user name"
            value={userId}
            onChange={(e) => onUserId(e.currentTarget.value)}
            autoComplete="username"
            required
          />
          <PasswordInput
            label="Password"
            value={password}
            onChange={(e) => onPassword(e.currentTarget.value)}
            autoComplete="current-password"
            required
          />
          {/* The button has no label above it, so without this it sits higher
              than the inputs it submits beside. */}
          <Group align="flex-end" h="100%">
            <Button type="submit" loading={busy} fullWidth>
              Sign in
            </Button>
          </Group>
        </SimpleGrid>
        {note && (
          <Alert color={note.kind === "error" ? "red" : "yellow"}>
            {note.text}
          </Alert>
        )}
      </Stack>
    </form>
  </Paper>
);
