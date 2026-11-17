/**
 * A game network that lets Bedrock players in through Floodgate names each of
 * them with a prefix, ".Steve" by default. A site whose usernames are player
 * names could not hold that account: every rule refused the dot. The prefix
 * is a separate allowance, off by default, and it widens nothing else: the
 * operator's rule still judges every character after it, only the first
 * position may hold it, and it counts toward the length.
 */
import { describe, it, expect } from "vitest";
import {
    DEFAULT_USERNAME_PREFIX,
    USERNAME_PREFIXES,
    USERNAME_RULES,
    USERNAME_SHAPE,
    checkUsername,
    isUsernamePrefix,
} from "@/core/lib/registration-rules";
import { registerSchema, updateUserSchema } from "@/core/lib/validations";
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "@/core/lib/constants";

const MIN = USERNAME_MIN_LENGTH;

describe("the prefix setting", () => {
    it("is off unless an operator turns it on", () => {
        expect(DEFAULT_USERNAME_PREFIX).toBe("none");
        expect(checkUsername(".Steve", "default", MIN)).toEqual({ ok: false, reason: "charset" });
        expect(checkUsername(".Steve", "default", MIN, "none")).toEqual({ ok: false, reason: "charset" });
    });

    it("is one of a fixed list, never a character an operator types", () => {
        expect(USERNAME_PREFIXES).toEqual(["none", "dot"]);
        expect(isUsernamePrefix("dot")).toBe(true);
        expect(isUsernamePrefix(".")).toBe(false);
        expect(isUsernamePrefix(undefined)).toBe(false);
    });
});

describe("with the dot on", () => {
    it("lets a name start with one dot", () => {
        expect(checkUsername(".xScared7", "default", MIN, "dot").ok).toBe(true);
        expect(checkUsername(".ab", "default", MIN, "dot").ok).toBe(true);
    });

    it("still takes a name without it", () => {
        expect(checkUsername("Steve_9", "default", MIN, "dot").ok).toBe(true);
    });

    it("counts the dot toward both lengths", () => {
        expect(checkUsername(".a", "default", MIN, "dot")).toEqual({ ok: false, reason: "too_short" });
        expect(checkUsername("." + "a".repeat(USERNAME_MAX_LENGTH - 1), "default", MIN, "dot").ok).toBe(true);
        expect(checkUsername("." + "a".repeat(USERNAME_MAX_LENGTH), "default", MIN, "dot")).toEqual({
            ok: false,
            reason: "too_long",
        });
    });

    it("allows only one, and only first", () => {
        for (const name of ["..abc", "a.bc", "abc.", ".a.b", "...", ".", ". abc"]) {
            expect(checkUsername(name, "default", MIN, "dot").ok, name).toBe(false);
        }
    });

    it("leaves the rest to the operator's rule", () => {
        expect(checkUsername(".with_under", "letters_numbers", MIN, "dot")).toEqual({ ok: false, reason: "charset" });
        expect(checkUsername(".Plain9", "lowercase", MIN, "dot")).toEqual({ ok: false, reason: "charset" });
        expect(checkUsername(".plain9", "lowercase", MIN, "dot").ok).toBe(true);
    });
});

describe("no rule with a prefix widens the default with the same prefix", () => {
    const names = [
        "abc", ".abc", "..abc", ".a", ".ab", "a.b", ".a_b", ".A_B", "._x", ".аdmin", ". x",
        "." + "a".repeat(USERNAME_MAX_LENGTH - 1), "." + "a".repeat(USERNAME_MAX_LENGTH),
    ];
    for (const prefix of USERNAME_PREFIXES) {
        for (const rule of USERNAME_RULES) {
            it(`"${rule}" with "${prefix}"`, () => {
                for (const name of names) {
                    if (checkUsername(name, rule, MIN, prefix).ok) {
                        expect(checkUsername(name, "default", MIN, prefix).ok, name).toBe(true);
                        expect(USERNAME_SHAPE.test(name), name).toBe(true);
                    }
                }
            });
        }
    }
});

describe("the schemas that run before the setting is read", () => {
    const register = (username: string) =>
        registerSchema.safeParse({ email: "a@b.co", username, password: "Correct-horse-9", confirmPassword: "Correct-horse-9" });

    it("let a prefixed name through to the route, which decides", () => {
        expect(updateUserSchema.safeParse({ username: ".Steve" }).success).toBe(true);
        expect(register(".Steve").error?.issues.some((issue) => issue.path[0] === "username")).toBeFalsy();
    });

    it("still refuse what no setting allows", () => {
        for (const name of ["..Steve", "St.eve", "has space", "has-dash"]) {
            expect(updateUserSchema.safeParse({ username: name }).success, name).toBe(false);
        }
    });
});
