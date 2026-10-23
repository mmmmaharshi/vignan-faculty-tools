import { Button, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import {
  CalendarCheck,
  House,
  MagnifyingGlass,
  UserCircle,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";

export const LOGIN_PATH = "/login";
export const HOME_PATH = "/home";
export const DASHBOARD_PATH = "/dashboard";
export const PROFILE_PATH = "/profile";
export const SEARCH_PATH = "/search";
/** Every screen the navigation can name, in the order both surfaces show
 *  them. One array, so an icon or label change cannot land on the rail and
 *  miss the bar: the two surfaces differ only in chrome, never in content. */
const TABS: readonly { path: string; label: string; Icon: Icon }[] = [
  { path: HOME_PATH, label: "Home", Icon: House },
  { path: DASHBOARD_PATH, label: "Attendance", Icon: CalendarCheck },
  { path: SEARCH_PATH, label: "Student Search", Icon: MagnifyingGlass },
  { path: PROFILE_PATH, label: "Profile", Icon: UserCircle },
];
/** Which tab the address bar names. Anything else is the register screen:
 *  unknown paths render its body before the guard sends them on, so the
 *  highlight must agree with the screen rather than going dark. */
export const activeTab = (pathname: string): string =>
  TABS.some((tab) => tab.path === pathname) ? pathname : DASHBOARD_PATH;
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
