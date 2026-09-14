import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import test from "node:test";
import {
  linuxGraphicalSessionEnvironment,
  linuxUserSessionEnvironment,
} from "../platform/linux/src/user-session.js";

test("session discovery supplies a verified bus when both launcher variables are absent", async () => {
  const root = await realpath(await mkdtemp("/tmp/gp-user-session-"));
  const bus = createServer();
  try {
    const runtime = resolve(root, "runtime");
    const bin = resolve(root, "bin");
    await mkdir(runtime, { mode: 0o700 });
    await mkdir(bin);
    await new Promise<void>((done, reject) => {
      bus.once("error", reject);
      bus.listen(resolve(runtime, "bus"), done);
    });
    const loginctl = resolve(bin, "loginctl");
    const query = `#!/bin/sh\n[ "$1" = show-user ] && [ "$2" = ${process.getuid?.()} ] && [ "$3" = --property=RuntimePath ] && [ "$4" = --value ] || exit 3\nprintf '%s\\n' '${runtime}'\n`;
    await writeFile(loginctl, query, { mode: 0o700 });
    const env = { ...process.env, PATH: bin };
    delete env.DBUS_SESSION_BUS_ADDRESS;
    delete env.XDG_RUNTIME_DIR;
    const found = linuxUserSessionEnvironment(env);
    assert.equal(found.XDG_RUNTIME_DIR, runtime);
    assert.equal(found.DBUS_SESSION_BUS_ADDRESS, `unix:path=${runtime}/bus`);
    assert.equal(env.XDG_RUNTIME_DIR, undefined, "must not mutate caller environment");
    assert.equal(env.DBUS_SESSION_BUS_ADDRESS, undefined);
    const systemctl = resolve(bin, "systemctl");
    await writeFile(
      systemctl,
      `#!/bin/sh
[ "$1" = --user ] && [ "$2" = show-environment ] && [ "$XDG_RUNTIME_DIR" = '${runtime}' ] || exit 3
printf '%s\\n' 'DISPLAY=:7' 'GTK_IM_MODULE=fcitx' 'QT_IM_MODULE=fcitx' 'XMODIFIERS=@im=fcitx'
`,
      { mode: 0o700 },
    );
    const graphical = linuxGraphicalSessionEnvironment({ ...env, DISPLAY: ":wrong" });
    assert.equal(graphical.DISPLAY, ":7");
    assert.equal(graphical.GTK_IM_MODULE, "fcitx");
    assert.equal(graphical.QT_IM_MODULE, "fcitx");
    assert.equal(graphical.XMODIFIERS, "@im=fcitx");
    await writeFile(systemctl, "#!/bin/sh\nprintf '%s\\n' 'GTK_IM_MODULE=fcitx'\n");
    assert.throws(
      () => linuxGraphicalSessionEnvironment(env),
      /LINUX_GRAPHICAL_SESSION_ENVIRONMENT_UNAVAILABLE/u,
    );
    assert.equal(
      linuxUserSessionEnvironment({
        ...env,
        XDG_RUNTIME_DIR: "/wrong",
        DBUS_SESSION_BUS_ADDRESS: "unix:path=/wrong",
      }).XDG_RUNTIME_DIR,
      runtime,
    );
    await chmod(runtime, 0o755);
    assert.throws(() => linuxUserSessionEnvironment(env), /LINUX_USER_SESSION_DIRECTORY_INVALID/u);
    await chmod(runtime, 0o700);
    await writeFile(loginctl, "#!/bin/sh\nexit 1\n");
    assert.throws(() => linuxUserSessionEnvironment(env), /LINUX_USER_SESSION_LOOKUP_FAILED/u);
    await writeFile(loginctl, "#!/bin/sh\nprintf '\\n'\n");
    assert.throws(() => linuxUserSessionEnvironment(env), /LINUX_USER_SESSION_PATH_INVALID/u);
    await writeFile(loginctl, query);
    await new Promise<void>((done) => bus.close(() => done()));
    await writeFile(resolve(runtime, "bus"), "not a socket");
    assert.throws(() => linuxUserSessionEnvironment(env), /LINUX_USER_SESSION_BUS_INVALID/u);
    await rm(resolve(runtime, "bus"));
    await symlink(resolve(root, "elsewhere"), resolve(runtime, "bus"));
    assert.throws(() => linuxUserSessionEnvironment(env), /LINUX_USER_SESSION_BUS_INVALID/u);
  } finally {
    if (bus.listening) await new Promise<void>((done) => bus.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
