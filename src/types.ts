export type Gender = 'female' | 'male' | 'other';

/** ISO date string, YYYY-MM-DD. Partial dates like "1950" or "1950-03" are allowed. */
export type ISODate = string;

export interface Person {
  id: string;
  firstName: string;
  /** Optional middle name(s), shown between first and last name. */
  middleNames?: string;
  lastName: string;
  /** "female", "male", "other", or null when unknown. */
  gender?: Gender | null;
  /** Path relative to /public (e.g. "photos/roberto.jpg") or an absolute URL. */
  photo: string | null;
  /** Lowercase Spanish demonyms, e.g. ["argentina", "española"]. A list, since dual nationality is common. Not displayed yet. */
  nationality: string[];
  /** Reserved — not displayed yet. */
  birthDate: ISODate | null;
  /** Reserved — not displayed yet. */
  deathDate: ISODate | null;
}

/**
 * A union links one or two parents to their children.
 * A person can be in any number of unions (remarriages, exes with kids),
 * and a child belongs to exactly one union (its parents).
 */
export type UnionStatus = 'married' | 'partnered' | 'separated' | 'divorced' | 'widowed';

export interface Union {
  id: string;
  /** One id (single/unknown other parent) or two ids. */
  partners: string[];
  status: UnionStatus;
  children: string[];
}

/** One family tree. It's shown at a URL like `/?arbol=<uid>`. */
export interface FamilyTree {
  /** Identifier used in the URL. Hard to guess, so a tree is only reachable through its link. */
  uid: string;
  /** Shown as the page heading. */
  name: string;
  people: Person[];
  unions: Union[];
}

/** The whole data file: any number of trees. */
export interface FamilyData {
  version: 2;
  trees: FamilyTree[];
}

export const fullName = (p: Person) =>
  [p.firstName, p.middleNames, p.lastName].filter(Boolean).join(' ');

export const isEnded = (u: Union) => u.status === 'separated' || u.status === 'divorced';
