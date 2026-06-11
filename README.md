# MubarakLab — studio site

Static site for [mubaraklab.com](https://mubaraklab.com). Plain HTML/CSS, no
build step. Hosted on GitHub Pages.

## Structure

```
index.html              Landing page
styles.css              Shared styles (auto dark mode)
privacy/_template/      Privacy policy template
terms/_template/        Terms of use template
404.html                Not-found page
CNAME                   Custom domain for GitHub Pages
```

## Adding pages for a new app

For an app called "Focus Timer" with URL slug `focustimer`:

```sh
cp -r privacy/_template privacy/focustimer
cp -r terms/_template terms/focustimer
```

Then in both new `index.html` files, replace:

| Placeholder    | Replace with                          |
|----------------|---------------------------------------|
| `APP_NAME`     | Focus Timer                           |
| `APP_SLUG`     | focustimer                            |
| `UPDATED_DATE` | Today's date, e.g. June 11, 2026      |

Review the HTML comments inside each template — if the app collects data or
has in-app purchases, update those sections accordingly.

The pages go live at:

- `https://mubaraklab.com/privacy/focustimer/`
- `https://mubaraklab.com/terms/focustimer/`

Commit and push to deploy:

```sh
git add -A && git commit -m "Add Focus Timer policy pages" && git push
```
