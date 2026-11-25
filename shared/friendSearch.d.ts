type SearchableFriend = {
  firstName?: string | null; lastName?: string | null; university?: string | null;
  bio?: string | null; lifestyle?: string | null;
};

export function friendSearchTerms(query: string): string[];
export function matchesFriendSearch(person: SearchableFriend, query: string): boolean;
