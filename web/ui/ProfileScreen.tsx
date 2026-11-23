import { Button, Group } from "@mantine/core";
import { SignOut } from "@phosphor-icons/react";
import React from "react";

import type { ProfilePanelProps } from "./ProfilePanel";
import { ProfilePanel } from "./ProfilePanel";

/** The signed-in faculty's own screen. On a phone it also carries Sign out,
 *  because the rail is not shown below `sm`. */
export const ProfileScreen = ({
  onSignOut,
  ...faculty
}: ProfilePanelProps & {
  onSignOut: () => void;
}): React.JSX.Element => (
  <>
    <ProfilePanel {...faculty} />
    <Group hiddenFrom="sm" justify="flex-end" mt="lg">
      <Button
        onClick={onSignOut}
        variant="default"
        leftSection={<SignOut size={18} aria-hidden />}
      >
        Sign out
      </Button>
    </Group>
  </>
);
