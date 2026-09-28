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

/**
 * The sign-in screen.
 *
 * One of the three modes `App` composes, extracted so that reading it does not
 * require scrolling past the cascade. It owns no state of its own - every value
 * and handler arrives as a prop - which keeps `App` the only place the session
 * lifecycle is decided.
 */

type SignInPanelProps = {
  userId: string;
  password: string;
  busy: boolean;
  note: Note | null;
  onUserId: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

/**
 * The reassurance shown when there is no error. Hoisted because it never varies,
 * so the same element descriptor is reused rather than rebuilt on every render.
 */
const REASSURANCE = (
  <Alert color="blue">
    Your credentials are used once to sign in and are never stored by this app.
    Signing in opens a session that stays active for up to 12 hours.
  </Alert>
);

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
        <Group grow align="flex-end">
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
        {note ? (
          <Alert color={note.kind === "error" ? "red" : "yellow"}>
            {note.text}
          </Alert>
        ) : (
          REASSURANCE
        )}
      </Stack>
    </form>
  </Paper>
);
