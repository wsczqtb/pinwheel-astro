import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import * as pagefind from "pagefind";

const posts = JSON.parse(
  await readFile(
    new URL("../src/data/remote-posts.json", import.meta.url),
    "utf8",
  ),
);
const { index } = await pagefind.createIndex({ forceLanguage: "zh-cn" });

try {
  const staticResult = await index.addDirectory({ path: "dist" });
  if (staticResult.errors.length)
    throw new Error(staticResult.errors.join("\n"));

  for (let offset = 0; offset < posts.length; offset += 12) {
    const batch = posts.slice(offset, offset + 12);
    const articles = await Promise.all(
      batch.map(async (post) => {
        const response = await fetch(post.sourceUrl);
        if (!response.ok) {
          throw new Error(
            `Could not index ${post.sourceUrl}: HTTP ${response.status}`,
          );
        }
        return { post, content: matter(await response.text()).content };
      }),
    );

    for (const { post, content } of articles) {
      const result = await index.addCustomRecord({
        url: `/blog/${post.id}`,
        content,
        language: "zh-cn",
        meta: {
          title: post.data.title,
          description: post.data.description || "",
          image: post.data.image || "",
        },
        filters: { categories: post.data.categories },
      });
      if (result.errors.length) throw new Error(result.errors.join("\n"));
    }
  }

  const writeResult = await index.writeFiles({ outputPath: "dist/pagefind" });
  if (writeResult.errors.length) throw new Error(writeResult.errors.join("\n"));
} finally {
  await pagefind.close();
}
