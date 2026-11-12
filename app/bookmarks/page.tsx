import { getNavStructure } from "@/lib/content";
import BookmarksView from "@/components/BookmarksView";

export default function BookmarksPage() {
  const parashot = getNavStructure().flatMap((book) => book.parashot)
    .filter((parasha) => parasha.available)
    .map(({ slug, name }) => ({ slug, name }));
  return <BookmarksView parashot={parashot} />;
}
