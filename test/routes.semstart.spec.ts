import { expect, test } from "@playwright/test";

import { handleSemStart } from "../server/class-routes";
import { HttpError } from "../server/http-error";
import type { PortalReader } from "../server/portal-reader";
import { fake, levels, walkDated, walked } from "./support/routes-fake";

test.describe("the semester start probe", () => {
  const GRID = `<table>
    <tr><th>Sl.No</th><th>Roll.No</th><th>Name</th><th>05/08</th><th>06/08</th><th>Attend/Held</th><th>%</th></tr>
    <tr><td>1</td><td>21CS001</td><td>A</td><td>P</td><td>A</td><td>1/2</td><td>50</td></tr>
  </table>`;
  test("one subject's earliest held day, resolved into the asked range", async () => {
    const { reader, calls } = fake({ register: GRID });
    const reply = await handleSemStart(
      reader,
      levels({ from: "01/05/2026", to: "18/10/2026" })
    );
    expect(calls.register, "one grid read, never a roster").toHaveLength(1);
    expect(reply).toEqual({ statedFrom: "05/08/2026" });
  });
  test("a grid that states no dates states no start, not a wrong one", async () => {
    const { reader } = fake();
    const reply = await handleSemStart(reader, levels());
    expect(reply).toEqual({ statedFrom: null });
  });
  test("no date range is refused before the portal is asked", async () => {
    const { reader, calls } = fake();
    await expect(handleSemStart(reader, levels({ from: "" }))).rejects.toThrow(
      "Choose a date range."
    );
    expect(calls.register).toHaveLength(0);
  });
  test("a dead session stays a 401, so the client signs out", async () => {
    const { reader } = fake();
    const dead: PortalReader = {
      ...reader,
      register: () => Promise.reject(new HttpError(401, "expired")),
    };
    const failure = await handleSemStart(dead, levels()).catch(
      (error: unknown) => error
    );
    expect((failure as HttpError).status).toBe(401);
  });
});

test.describe("the semester start walk", () => {
  const dateless =
    "<table><tr><th>Sl.No</th><th>Roll No</th><th>Name</th><th>Attend / Held</th><th>%</th></tr>" +
    "<tr><td>1</td><td>21CS001</td><td>A Student</td><td>0/0</td><td>0</td></tr></table>";
  const walking = (grids: Record<string, string>) => {
    const { reader } = fake();
    const months: { from: string; to: string }[] = [];
    const walkingReader: PortalReader = {
      ...reader,
      register: (p) => {
        months.push({ from: p.from, to: p.to });
        return Promise.resolve(grids[p.from] ?? dateless);
      },
    };
    return { reader: walkingReader, months };
  };
  test("walks back month by month to the first held day", async () => {
    const { reader, months } = walking({
      "01/10/2026": walkDated("12/10"),
      "01/09/2026": walkDated("03/09"),
    });
    const reply = await handleSemStart(reader, walked());
    expect(reply).toEqual({ statedFrom: "03/09/2026" });
    // The asked month plus two before it, each a month-shaped read — and the
    // dateless August stops the walk instead of being read past.
    expect(months).toEqual([
      { from: "01/10/2026", to: "31/10/2026" },
      { from: "01/09/2026", to: "30/09/2026" },
      { from: "01/08/2026", to: "31/08/2026" },
    ]);
  });
  test("a dateless asked month states no start after one read", async () => {
    const { reader, months } = walking({});
    const reply = await handleSemStart(reader, walked());
    expect(reply).toEqual({ statedFrom: null });
    expect(months).toHaveLength(1);
  });
  test("no walkBack reads the asked window alone, unshaped", async () => {
    const { reader, months } = walking({ "01/10/2026": walkDated("12/10") });
    const reply = await handleSemStart(
      reader,
      levels({ from: "01/10/2026", to: "18/10/2026" })
    );
    expect(reply).toEqual({ statedFrom: "12/10/2026" });
    expect(months).toEqual([{ from: "01/10/2026", to: "18/10/2026" }]);
  });
  test("the walk never exceeds twelve months back", async () => {
    const { reader, months } = walking({});
    const everDated: PortalReader = {
      ...reader,
      register: (p) => {
        months.push({ from: p.from, to: p.to });
        const [, mm] = p.from.split("/");
        return Promise.resolve(walkDated(`15/${mm}`));
      },
    };
    const reply = await handleSemStart(
      everDated,
      walked({ to: "18/10/2026", walkBack: 99 })
    );
    expect(months, "the asked month plus twelve before it").toHaveLength(13);
    expect(reply).toEqual({ statedFrom: "15/10/2025" });
  });
});
