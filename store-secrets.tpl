# Store publishing secrets shared by all of the publisher's extensions, as
# 1Password references (no values in this file). Same names in comment-vibe and
# chrome-ssr-csr. Item "Extension store secrets" in the Personal vault, one
# field per variable.
#
# New extension repo (1Password CLI `op` + GitHub CLI `gh`):
#   op inject -i store-secrets.tpl -o store-secrets.env \
#     && gh secret set -f store-secrets.env -R dzienisz/<repo> \
#     ; rm -f store-secrets.env
#   gh secret set CWS_EXTENSION_ID -R dzienisz/<repo>  # per extension
#   gh secret set EDGE_PRODUCT_ID -R dzienisz/<repo>   # per extension
# store-secrets.env is gitignored.
#
# Chrome Web Store API: Google Cloud OAuth client ("Desktop app"); refresh
# token from `npx chrome-webstore-upload-keys`. Keep the OAuth consent screen
# "In production": while it is "Testing", Google expires the refresh token
# after 7 days. CWS_PUBLISHER_ID (CWS dashboard → Account) is only read by
# chrome-ssr-csr and is the same for every extension.
CWS_CLIENT_ID={{ op://Personal/Extension store secrets/CWS_CLIENT_ID }}
CWS_CLIENT_SECRET={{ op://Personal/Extension store secrets/CWS_CLIENT_SECRET }}
CWS_REFRESH_TOKEN={{ op://Personal/Extension store secrets/CWS_REFRESH_TOKEN }}
CWS_PUBLISHER_ID={{ op://Personal/Extension store secrets/CWS_PUBLISHER_ID }}

# addons.mozilla.org: https://addons.mozilla.org/developers/addon/api/key/
# (generating new credentials revokes the old ones). The add-on itself is
# identified by the gecko id in its manifest.
AMO_JWT_ISSUER={{ op://Personal/Extension store secrets/AMO_JWT_ISSUER }}
AMO_JWT_SECRET={{ op://Personal/Extension store secrets/AMO_JWT_SECRET }}

# Microsoft Edge Add-ons: Partner Center → Microsoft Edge → Publish API.
# API keys expire after about 72 days: note the expiry date in the 1Password
# item and create a new key before it (old keys keep working until expiry).
EDGE_CLIENT_ID={{ op://Personal/Extension store secrets/EDGE_CLIENT_ID }}
EDGE_API_KEY={{ op://Personal/Extension store secrets/EDGE_API_KEY }}
