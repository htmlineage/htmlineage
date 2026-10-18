# Security

## Reporting a problem

Please report a security problem privately, not in a public issue. Use
GitHub's private vulnerability reporting: on the `htmlineage/htmlineage`
repository, open the Security tab and choose "Report a vulnerability".

## What `view` serves

`htmlineage view` starts a local server for the report you point it at.

- It listens on 127.0.0.1 only, so other machines cannot reach it.
- It refuses any request whose `Host` is not that address or `localhost`.
- It serves the report's folder: the report, its graph, and files beside it
  such as images. It never serves a name that starts with a dot, and never
  anything outside that folder.

No part of htmlineage connects to a warehouse or runs SQL.
