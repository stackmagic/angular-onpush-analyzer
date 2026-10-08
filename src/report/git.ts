import { execFileSync } from "node:child_process";

const NOT_A_REPOSITORY = /not a git repository/i;

/** HEAD commit of the repository containing `directory`, or null if it is not in a git repository. */
export function gitCommit(directory: string): string | null {
  try {
    // safe.directory: the analyzed workspace is typically mounted from a different owner.
    return execFileSync("git", ["-c", "safe.directory=*", "-C", directory, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // The message is matched below, so it must not be localized.
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
    }).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("git not found on PATH; it is needed to record the analyzed commit", { cause: error });
    }
    const { stderr } = error as { stderr?: string };
    if (typeof stderr === "string" && NOT_A_REPOSITORY.test(stderr)) {
      return null;
    }
    throw new Error(`git rev-parse HEAD failed in ${directory}: ${stderr?.trim() || (error as Error).message}`, {
      cause: error,
    });
  }
}
