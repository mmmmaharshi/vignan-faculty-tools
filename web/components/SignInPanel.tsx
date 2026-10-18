import {
  Alert,
  Button,
  Group,
  Paper,
  PasswordInput,
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
        <Group grow align="flex-end" wrap="wrap">
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
          <Button type="submit" loading={busy} fullWidth>
            Sign in
          </Button>
        </Group>
        {note && (
          <Alert color={note.kind === "error" ? "red" : "yellow"}>
            {note.text}
          </Alert>
        )}
      </Stack>
    </form>
  </Paper>
);
