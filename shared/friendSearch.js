export function friendSearchTerms(query) {
  return [...new Set(query.trim().toLowerCase().split(/\s+/u).filter(Boolean))];
}

export function matchesFriendSearch(person, query) {
  const fields = [person.firstName, person.lastName, person.university, person.bio, person.lifestyle]
    .map(value => (value ?? '').toLowerCase());
  return friendSearchTerms(query).every(term => fields.some(value => value.includes(term)));
}
