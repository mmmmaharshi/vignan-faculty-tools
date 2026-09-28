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
        {/* Nothing at all when there is no note. There used to be a standing
            reassurance here - that credentials are never stored, and how long the
            session lasts - and it was cut for two reasons. It was noise on a form
            with two fields. And the session claim was the one number on the
            screen this app could not back: the portal's own cookies are session
            cookies, so ECAP can end the session long before ours does (ADR 0014).
            A standing claim we cannot keep is worse than no claim. The
            "never stored" promise is still true, and still printed on every
            server start. */}
        {note && (
          <Alert color={note.kind === "error" ? "red" : "yellow"}>
            {note.text}
          </Alert>
        )}
      </Stack>
    </form>
  </Paper>
);
