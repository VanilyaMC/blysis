import { resolveAppUrl } from "@/core/sdk/server";
import { announce, siteUrl } from "../lib/announce";

interface BlogArticlePayload {
    id: string;
    number?: number | null;
    title: string;
    slug: string;
    excerpt?: string | null;
    status: string;
    author?: { username: string } | null;
    category?: { name: string } | null;
}

/**
 * Hook listener: fires on `blog.article.created`.
 * Sends a Discord webhook when a new blog article is published, with a link
 * to it and, when the operator chose one, a ping after it.
 */
export default async function onBlogArticleCreated(payload: BlogArticlePayload): Promise<void> {
    if (payload.status !== "PUBLISHED") return;

    const path = payload.number ? `/blog/${payload.number}/${payload.slug}` : `/blog/${payload.slug}`;
    const url = siteUrl(resolveAppUrl(), path);

    await announce({
        event: "blog.article.created",
        webhookKey: "blog_article_created",
        values: { title: payload.title, author: payload.author?.username ?? "", url },
        embed: {
            title: "New Blog Article",
            url,
            description: `**${payload.title}**${payload.excerpt ? `\n\n${payload.excerpt}` : ""}\n\n${url}`,
            color: 0x10b981,
            fields: [
                ...(payload.author ? [{ name: "Author", value: payload.author.username, inline: true }] : []),
                ...(payload.category ? [{ name: "Category", value: payload.category.name, inline: true }] : []),
            ],
            timestamp: new Date().toISOString(),
        },
    });
}
