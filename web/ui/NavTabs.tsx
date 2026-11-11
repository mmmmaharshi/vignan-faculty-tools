import { Button, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import {
  CalendarCheck,
  House,
  MagnifyingGlass,
  UserCircle,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";

import {
  DASHBOARD_PATH,
  HOME_PATH,
  PROFILE_PATH,
  SCREENS,
  SEARCH_PATH,
} from "../app/paths";
import type { Screen } from "../app/paths";
/** What each screen is called and which icon it carries. Keyed by the screen
 *  itself, so adding a path to `SCREENS` is a compile error until it is named
 *  here, and the rail and the bar read the same list. */
const CHROME: Record<Screen, { label: string; Icon: Icon }> = {
  [HOME_PATH]: { label: "Home", Icon: House },
  [DASHBOARD_PATH]: { label: "Register", Icon: CalendarCheck },
  [SEARCH_PATH]: { label: "Student Search", Icon: MagnifyingGlass },
  [PROFILE_PATH]: { label: "Profile", Icon: UserCircle },
};
/** Every screen both surfaces show, in tab order. */
const TABS = SCREENS.map((path) => ({ path, ...CHROME[path] }));
export type Navigate = (path: string) => void;
/** The desktop rail's tab buttons: stock `Button`s, the current screen a
 *  variant, and nothing else. `Button` has no `active` prop, so the variant
 *  is what cannot drift from the URL. */
export const RailNav = ({
  active,
  onNavigate,
}: {
  active: string;
  onNavigate: Navigate;
}): React.JSX.Element => (
  <Stack gap="xs">
    {TABS.map(({ path, label, Icon }) => (
      <Button
        key={path}
        onClick={() => onNavigate(path)}
        variant={active === path ? "filled" : "subtle"}
        aria-current={active === path ? "page" : undefined}
        leftSection={<Icon size={18} aria-hidden />}
        fullWidth
        justify="flex-start"
      >
        {label}
      </Button>
    ))}
  </Stack>
);
/** The phone bar's tabs: icon over label, no fill, a blue icon and a semibold
 *  label saying which screen. `UnstyledButton` is the one Mantine component
 *  with no button chrome, so the rail's variant swap has no meaning here. */
export const BarNav = ({
  active,
  onNavigate,
}: {
  active: string;
  onNavigate: Navigate;
}): React.JSX.Element => (
  <Group gap={0} wrap="nowrap" h="100%">
    {TABS.map(({ path, label, Icon }) => (
      <UnstyledButton
        key={path}
        onClick={() => onNavigate(path)}
        aria-current={active === path ? "page" : undefined}
        c={active === path ? "blue" : "dimmed"}
        flex={1}
        h="100%"
      >
        <Stack align="center" justify="center" gap={2} h="100%">
          <Icon size={24} aria-hidden />
          <Text size="xs" fw={active === path ? 600 : 400}>
            {label}
          </Text>
        </Stack>
      </UnstyledButton>
    ))}
  </Group>
);
