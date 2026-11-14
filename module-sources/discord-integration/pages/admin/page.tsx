"use client";


import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useState } from "react";
import { Link } from "@/core/sdk/navigation";
import { Button, Card, CardContent, Input, Label, LoadFailed, NativeSelect, buttonClassName } from "@/core/sdk/ui";
import { ArrowLeft, Loader2, Check, Send } from "lucide-react";
import { AdminPageHeader, useSettingsLoad } from "@/core/sdk/admin";

interface WebhookEvent {
    key: string;
    labelKey: string;
    descKey: string;
    /** The setting for who it pings, for an announcement that may ping. */
    mention?: string;
}

const webhookEvents: WebhookEvent[] = [
    { key: "discord_webhook_general", labelKey: "adm_evt_general", descKey: "adm_evt_general_desc" },
    { key: "discord_webhook_order_completed", labelKey: "adm_evt_orderCompleted", descKey: "adm_evt_orderCompleted_desc" },
    { key: "discord_webhook_order_created", labelKey: "adm_evt_orderCreated", descKey: "adm_evt_orderCreated_desc" },
    { key: "discord_webhook_ticket_created", labelKey: "adm_evt_ticketCreated", descKey: "adm_evt_ticketCreated_desc" },
    { key: "discord_webhook_user_registered", labelKey: "adm_evt_userRegistered", descKey: "adm_evt_userRegistered_desc" },
    { key: "discord_webhook_forum_topic_created", labelKey: "adm_evt_forumTopic", descKey: "adm_evt_forumTopic_desc" },
    { key: "discord_webhook_blog_article_created", labelKey: "adm_evt_blogArticle", descKey: "adm_evt_blogArticle_desc", mention: "discord_mention_blog_article_created" },
    { key: "discord_webhook_changelog_entry_published", labelKey: "adm_evt_changelogEntry", descKey: "adm_evt_changelogEntry_desc", mention: "discord_mention_changelog_entry_published" },
];

/** The announcements that can ping somebody after they are posted. */
const mentionKeys = webhookEvents.flatMap((event) => (event.mention ? [event.mention] : []));

/** What the ping setting holds: nobody, `@here`, `@everyone`, or a role id. */
type MentionKind = "none" | "here" | "everyone" | "role";

function mentionKind(value: string): MentionKind {
    if (value === "here" || value === "everyone") return value;
    return /^\d+$/.test(value) ? "role" : "none";
}

/*
 * These keys are not decoration: `sendDiscordWebhook(event)` looks up
 * `discord_webhook_${event}` and falls back to the general one, so an event
 * with no row here is an event an operator cannot route anywhere. A blog
 * article was such an event - the listener posted it, and every site that had
 * set a general webhook got articles in whichever channel it pointed at, with
 * no way to send them somewhere else.
 *
 * `a-discord-event-can-be-routed.test.ts` holds the two lists together.
 */

/** The header's submit button points at the form by id; they are the same form. */
const FORM_ID = "discord-webhooks-form";

export default function DiscordSettingsPage() {
    const t = useTranslations("discordIntegration");
    const commonT = useTranslations("common");
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [testing, setTesting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [webhooks, setWebhooks] = useState<Record<string, string>>({});
    // Kept apart from the webhooks: a role picked with no id typed yet is a
    // choice in progress, not "nobody", and must not snap back to it.
    const [mentions, setMentions] = useState<Record<string, { kind: MentionKind; role: string }>>({});

    // Every webhook falls back to the empty string, so a failed read showed
    // a form of empty fields and saving it deleted every configured webhook.
    const { loading, failed, retry } = useSettingsLoad((s) => {
        const wh: Record<string, string> = {};
        for (const event of webhookEvents) {
            wh[event.key] = (s[event.key] as string) || "";
        }
        setWebhooks(wh);
        const mn: Record<string, { kind: MentionKind; role: string }> = {};
        for (const key of mentionKeys) {
            const value = typeof s[key] === "string" ? (s[key] as string).trim() : "";
            const kind = mentionKind(value);
            mn[key] = { kind, role: kind === "role" ? value : "" };
        }
        setMentions(mn);
    });

    /** The ping settings as stored: "", "here", "everyone" or a role id. */
    const mentionSettings = (): Record<string, string> => {
        const out: Record<string, string> = {};
        for (const key of mentionKeys) {
            const choice = mentions[key] ?? { kind: "none", role: "" };
            const role = choice.role.trim();
            out[key] = choice.kind === "role" ? (/^\d{17,20}$/.test(role) ? role : "") : choice.kind === "none" ? "" : choice.kind;
        }
        return out;
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        setSaved(false);

        try {
            const res = await fetch("/api/v1/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...webhooks, ...mentionSettings() }),
            });

            if (!res.ok) {
                setError(commonT("somethingWentWrong"));
                return;
            }
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch {
            setError(commonT("somethingWentWrong"));
        } finally {
            setSaving(false);
        }
    };

    const testWebhook = async (key: string) => {
        const url = webhooks[key];
        if (!url) return;

        setTesting(key);
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    username: "Blysis",
                    embeds: [{
                        title: "Test Notification",
                        description: "This is a test webhook from Blysis. If you see this, your webhook is configured correctly!",
                        color: 0x22c55e,
                        timestamp: new Date().toISOString(),
                    }],
                }),
            });
            // A test that says nothing is not a test. Discord answers 204 on
            // success and 401 on a URL that has been revoked, which is exactly
            // what the admin pressed this button to find out.
            if (res.ok) toast.success(t("testSuccess"));
            else toast.error(t("testError"));
        } catch {
            // The browser blocked the cross-origin call, which says nothing
            // about the webhook: the server sends the real ones.
            toast.info(t("testBlocked"));
        } finally {
            setTesting(null);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (failed) {
        return (
            <>
                <AdminPageHeader
                    title={t("adm_discordWebhooks")}
                    description={t("adm_webhooksSubtitle")}
                    backHref="/admin/settings/general"
                    backLabel={commonT("back")}
                />
                <Card><CardContent><LoadFailed onRetry={retry} /></CardContent></Card>
            </>
        );
    }

    return (
        <>
            {/* The save is a header action, beside the way back, rather than
                between the last webhook card and the help box. */}
            <AdminPageHeader
                title={t("adm_discordWebhooks")}
                description={t("adm_webhooksSubtitle")}
                backHref="/admin/settings/general"
                backLabel={commonT("back")}
                actions={<>
                    <Link href="/admin/discord/messages" className={buttonClassName("outline", "default")}>
                        {t("adm_msgTitle")}
                    </Link>
                    <Button type="submit" form={FORM_ID} disabled={saving}>
                        {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("adm_saving")}</> :
                         saved ? <><Check className="w-4 h-4" /> {t("adm_saved")}</> : t("adm_saveWebhooks")}
                    </Button>
                </>}
            />

            {error && (
                <div role="alert" className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">{error}</div>
            )}

            <form id={FORM_ID} onSubmit={handleSave}>
                <div className="space-y-4">
                    {webhookEvents.map((event) => (
                        <Card key={event.key}>
                            <CardContent className="p-4">
                                <div className="flex items-start gap-4">
                                    <div className="flex-1">
                                        <Label className="font-medium">{t(event.labelKey)}</Label>
                                        <p className="text-xs text-muted-foreground mb-2">{t(event.descKey)}</p>
                                        <Input
                                            aria-label={t(event.labelKey)}
                                            value={webhooks[event.key]}
                                            onChange={(e) => setWebhooks({ ...webhooks, [event.key]: e.target.value })}
                                            placeholder="https://discord.com/api/webhooks/..."
                                        />
                                        {event.mention && (
                                            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                <div>
                                                    <Label className="text-xs">{t("adm_mention")}</Label>
                                                    <NativeSelect
                                                        aria-label={t("adm_mention")}
                                                        className="w-full"
                                                        value={mentions[event.mention as string]?.kind ?? "none"}
                                                        onChange={(e) => setMentions({
                                                            ...mentions,
                                                            [event.mention as string]: { kind: e.target.value as MentionKind, role: mentions[event.mention as string]?.role ?? "" },
                                                        })}
                                                    >
                                                        <option value="none">{t("adm_mention_none")}</option>
                                                        <option value="here">@here</option>
                                                        <option value="everyone">@everyone</option>
                                                        <option value="role">{t("adm_mention_role")}</option>
                                                    </NativeSelect>
                                                </div>
                                                {mentions[event.mention as string]?.kind === "role" && (
                                                    <div>
                                                        <Label className="text-xs">{t("adm_mention_roleId")}</Label>
                                                        <Input
                                                            aria-label={t("adm_mention_roleId")}
                                                            inputMode="numeric"
                                                            value={mentions[event.mention as string]?.role ?? ""}
                                                            onChange={(e) => setMentions({
                                                                ...mentions,
                                                                [event.mention as string]: { kind: "role", role: e.target.value.replace(/\D/g, "") },
                                                            })}
                                                            placeholder="123456789012345678"
                                                        />
                                                    </div>
                                                )}
                                                <p className="text-xs text-muted-foreground sm:col-span-2">{t("adm_mention_desc")}</p>
                                            </div>
                                        )}
                                    </div>
                                    {webhooks[event.key] && (
                                        <Button
                                            aria-label={t("testWebhook")}
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="mt-6"
                                            onClick={() => testWebhook(event.key)}
                                            disabled={testing === event.key}
                                        >
                                            {testing === event.key ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>

            </form>

            <div className="mt-6 p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">
                    <strong>{t("adm_howToGetWebhook")}</strong> {t("adm_howToGetWebhookBody")}
                </p>
            </div>
        </>
    );
}
