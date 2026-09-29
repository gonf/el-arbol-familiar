# Arbol genealógico

React + TypeScript (Vite). Renders family trees from `public/data/family.json` as a
pannable, zoomable tree. The interface is in Argentine Spanish.

    npm install
    npm run dev

## Which tree is shown

Each tree has a `uid`, and a tree is opened with the `arbol` URL variable:

    https://your-server/?arbol=pato-fernandez

Without `?arbol=` the site shows a short page saying you need a link to see a tree.
An unknown uid shows a "not found" page. Nothing is downloaded and no tree names are
listed on either page.

Note: the uid keeps a tree out of sight, not secret. All trees live in the same file,
so anyone who opens one tree's link can technically download the whole file.

## Keeping it out of search engines

- `public/robots.txt` asks all crawlers not to crawl the site.
- `index.html` has `<meta name="robots" content="noindex, …">` so the page is never listed.
- `public/.htaccess` (Apache) sends `X-Robots-Tag: noindex, …` on every response, which also
  covers `family.json` and the photos. On nginx, add this to the site's `server` block instead:

      add_header X-Robots-Tag "noindex, nofollow, noarchive, nosnippet, noimageindex" always;

These are respected by legitimate search engines and AI crawlers. They don't stop bots that
ignore the rules; only a password would.

## Data format (`public/data/family.json`)

    {
      "version": 2,
      "trees": [
        { "uid": "pato-fernandez", "name": "Familia Pato Fernández", "people": [...], "unions": [...] }
      ]
    }

To add a tree, add another object to `trees` with its own random `uid` (letters and
digits, hard to guess) and a `name`, which becomes the page heading and tab title.
Person and union ids only need to be unique within their own tree.

A **person**:

| field         | type           | notes                                                 |
| ------------- | -------------- | ----------------------------------------------------- |
| `id`          | string         | unique within the tree, referenced by unions          |
| `firstName`   | string         |                                                       |
| `middleNames` | string?        | optional                                              |
| `lastName`    | string         | may be empty                                          |
| `gender`      | string \| null | `"female"`, `"male"`, `"other"`, or `null` if unknown |
| `photo`       | string \| null | `"photos/name.webp"` (in `public/`) or a full URL     |
| `nationality` | string[]       | e.g. `["argentina", "española"]`; not displayed yet   |
| `birthDate`   | string \| null | reserved, `YYYY-MM-DD`; not displayed yet             |
| `deathDate`   | string \| null | reserved, `YYYY-MM-DD`; not displayed yet             |

Photos: square, about 512×512 px, JPEG or WebP. Non-square photos are centre-cropped.
They load lazily as their card nears the visible part of the tree.

A **union** connects 1–2 parents with their children:

    { "id": "u-hector-marta", "partners": ["hector-fernandez", "marta-reus"], "status": "divorced", "children": ["natalia-fernandez"] }

`status`: `married` | `partnered` | `separated` | `divorced` | `widowed`.
`separated` and `divorced` draw a dotted partner line and count as ex-partners.

Rules:

- A person can be in many unions (remarriage, ex with kids, new partner with kids).
- A child belongs to exactly one union's `children`.
- Unknown other parent: a union with a single partner.
- Add a branch **up**: create the parents and a union with the person in `children`.
- Add a branch **down**: create the kids and add them to a union's `children`.

Problems in the file (duplicate uids or ids, unknown people, a child with two sets of
parents) are listed in the browser console, with a notice on the page.

## Layout

`src/layout.ts` runs in a Web Worker (`src/layout.worker.ts`). Generations and positions
are computed automatically, then a search rearranges families to avoid crossing lines.
`layout.crossings` reports anything it couldn't untangle.

## Using it

- Drag to pan; wheel, pinch or the − / + buttons to zoom; "Ajustar" fits the whole tree.
  Arrow keys pan and + / − / 0 zoom when the tree has focus.
- Click (or tap, or Tab + Enter) a person to centre them (zooming in to a readable size if
  needed) and highlight their **direct line** (ancestors
  and descendants). **Close family** gets a lighter shade: children that the selected person's or their
  parents' current partners had with someone else; the selected person's siblings (including
  half-siblings) and all their descendants; and the current partner of anyone highlighted.
- "Estadísticas" (top right) opens a side panel with: the gender split overall and per
  generation; the most common first surnames and first names (accents and case ignored, so
  "Maria" and "María" count together); and who has the most children and descendants. People who share the
  same result, like a couple and their children, share a row. Click any name to select and
  centre that person in the tree. Escape or ✕ closes the panel.
- "Centrar" glides to the selected person. Click them again, click the background, press
  Escape or use "Limpiar" to clear.
- On phones the layout is compact to leave room for the tree: the "Elegí a una persona…" hint
  is hidden, the summary line moves into the stats panel, "Estadísticas" becomes an icon next to the legend, the zoom bar is smaller, and
  "Centrar" and "Limpiar" become a bullseye and a ✕.
