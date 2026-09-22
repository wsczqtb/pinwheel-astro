import remotePosts from "@/data/remote-posts.json";
import { getCollection } from "astro:content";

export type BlogPostSummary = {
  id: string;
  data: {
    title: string;
    description?: string;
    date?: string;
    image?: string;
    author?: string;
    categories: string[];
    featured?: boolean;
  };
  sourceUrl?: string;
};

export const getBlogPosts = async (): Promise<BlogPostSummary[]> => {
  const localPosts = await getCollection(
    "blog",
    ({ id, data }) => !id.startsWith("-") && data.draft !== true,
  );

  const local = localPosts.map(({ id, data }) => ({
    id,
    data: {
      title: data.title,
      description: data.description,
      date: data.date?.toISOString(),
      image: data.image,
      author: data.author,
      categories: data.categories,
      featured: data.featured,
    },
  }));

  return [...local, ...(remotePosts as BlogPostSummary[])].sort(
    (a, b) =>
      new Date(b.data.date || 0).valueOf() -
      new Date(a.data.date || 0).valueOf(),
  );
};

export const getBlogCategories = async () => [
  ...new Set((await getBlogPosts()).flatMap((post) => post.data.categories)),
];
