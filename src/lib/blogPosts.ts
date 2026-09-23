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

const CATEGORY_ORDER = [
  "industry-news",
  "cross-border",
  "amazon-operation",
  "others",
];

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

export const getBlogCategories = async () => {
  const categories = [
    ...new Set((await getBlogPosts()).flatMap((post) => post.data.categories)),
  ];
  const order = new Map(
    CATEGORY_ORDER.map((category, index) => [category, index]),
  );

  return categories.sort((a, b) => {
    const aIndex = order.get(a) ?? CATEGORY_ORDER.length;
    const bIndex = order.get(b) ?? CATEGORY_ORDER.length;
    return aIndex - bIndex || a.localeCompare(b);
  });
};
