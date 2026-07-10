#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DOCTOR="$SCRIPT_DIR/toy_doctor.py"
API_ORIGIN="${TOY_API_ORIGIN:-https://www.bilibili.com}"
API_ROOT="${TOY_API_ROOT:-/x/sunflower/artifex/toy}"
COOKIE_FILE="${TOY_COOKIE_FILE:-${HOME:-}/.bilibili_cookie}"
CURL_CONNECT_TIMEOUT="${TOY_CURL_CONNECT_TIMEOUT:-15}"
CURL_MAX_TIME="${TOY_CURL_MAX_TIME:-180}"

COMMAND=""
DIR="${TOY_DIR:-}"
TITLE="${TOY_TITLE:-}"
SLUG="${TOY_SLUG:-}"
POSTER="${TOY_POSTER:-}"
ID="${TOY_ID:-}"
UID_VAL="${TOY_UID:-auto}"
DISTRIBUTION_MODE="${TOY_DISTRIBUTION_MODE:-}"
ACCESS_PASSWORD="${TOY_ACCESS_PASSWORD:-}"

info() { printf '%b%s%b\n' "$BLUE" "$1" "$NC"; }
warn() { printf '%bWARN:%b %s\n' "$YELLOW" "$NC" "$1" >&2; }
success() { printf '%b%s%b\n' "$GREEN" "$1" "$NC"; }
error() { printf '%bERROR:%b %s\n' "$RED" "$NC" "$1" >&2; exit 1; }

show_help() {
  cat <<'HELP'
Bilibili Toy publisher

Usage:
  publish.sh <preview|create|update> [options]

Options:
  --dir <path>                 Static directory with root index.html
  --title <text>               Toy title
  --slug <slug>                Stable create slug
  --poster <path>              .png/.jpg/.jpeg cover
  --id <number>                Existing project ID for update
  --uid <auto|number>          Default: auto from Cookie DedeUserID
  --distribution-mode <mode>   PASSWORD | LINK_ONLY | PUBLIC_BIP
  --access-password <password> Required only for PASSWORD

Environment:
  TOY_COOKIE_FILE
  TOY_API_ORIGIN               Default: https://www.bilibili.com
  TOY_API_ROOT                 Default: /x/sunflower/artifex/toy
  TOY_DIR TOY_TITLE TOY_SLUG TOY_POSTER TOY_ID TOY_UID
  TOY_DISTRIBUTION_MODE TOY_ACCESS_PASSWORD
HELP
}

require_value() { [[ -n "${2:-}" ]] || error "$1 requires a value"; }

parse_args() {
  [[ $# -gt 0 ]] || { show_help; exit 0; }
  COMMAND="$1"; shift
  case "$COMMAND" in preview|create|update) ;; -h|--help) show_help; exit 0 ;; *) error "unknown command: $COMMAND" ;; esac
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dir) require_value "$1" "${2:-}"; DIR="$2"; shift 2 ;;
      --title) require_value "$1" "${2:-}"; TITLE="$2"; shift 2 ;;
      --slug) require_value "$1" "${2:-}"; SLUG="$2"; shift 2 ;;
      --poster) require_value "$1" "${2:-}"; POSTER="$2"; shift 2 ;;
      --id) require_value "$1" "${2:-}"; ID="$2"; shift 2 ;;
      --uid) require_value "$1" "${2:-}"; UID_VAL="$2"; shift 2 ;;
      --distribution-mode) require_value "$1" "${2:-}"; DISTRIBUTION_MODE="$2"; shift 2 ;;
      --access-password) require_value "$1" "${2:-}"; ACCESS_PASSWORD="$2"; shift 2 ;;
      -h|--help) show_help; exit 0 ;;
      *) error "unknown option: $1" ;;
    esac
  done
}

cookie_value() {
  local key="$1" cookie="$2" entry name value
  IFS=';' read -r -a entries <<< "$cookie"
  for entry in "${entries[@]}"; do
    entry="${entry#"${entry%%[![:space:]]*}"}"
    [[ "$entry" == *=* ]] || continue
    name="${entry%%=*}"; value="${entry#*=}"
    [[ "$name" == "$key" ]] && { printf '%s' "$value"; return 0; }
  done
  return 1
}

COOKIE=""
COOKIE_UID=""
CSRF=""
check_auth() {
  [[ -f "$COOKIE_FILE" ]] || { warn "cookie file not found: $COOKIE_FILE"; exit 170; }
  chmod 600 "$COOKIE_FILE" 2>/dev/null || true
  COOKIE="$(tr -d '\r\n' < "$COOKIE_FILE")"
  [[ -n "$COOKIE" ]] || { warn "cookie file is empty: $COOKIE_FILE"; exit 170; }
  COOKIE_UID="$(cookie_value DedeUserID "$COOKIE" || true)"
  [[ "$COOKIE_UID" =~ ^[0-9]+$ ]] || error "cookie does not contain a valid DedeUserID"
  CSRF="$(cookie_value bili_jct "$COOKIE" || true)"
  if [[ -z "$UID_VAL" || "$UID_VAL" == auto ]]; then
    UID_VAL="$COOKIE_UID"
  elif [[ "$UID_VAL" != "$COOKIE_UID" ]]; then
    error "UID mismatch: supplied UID does not match Cookie DedeUserID"
  fi
  info "Identity check: DedeUserID=$COOKIE_UID"
}

validate() {
  command -v curl >/dev/null || error "missing dependency: curl"
  command -v python3 >/dev/null || error "missing dependency: python3"
  [[ -f "$DOCTOR" ]] || error "missing bundled doctor: $DOCTOR"
  [[ "$UID_VAL" == auto || "$UID_VAL" =~ ^[0-9]+$ ]] || error "--uid must be auto or numeric"
  [[ -z "$ID" || "$ID" =~ ^[0-9]+$ ]] || error "--id must be numeric"
  [[ -z "$SLUG" || "$SLUG" =~ ^[A-Za-z0-9][A-Za-z0-9-]*$ ]] || error "invalid slug"
  if [[ -n "$DISTRIBUTION_MODE" ]]; then
    case "$DISTRIBUTION_MODE" in PASSWORD|LINK_ONLY|PUBLIC_BIP) ;; *) error "invalid distribution mode" ;; esac
  fi
  if [[ "$DISTRIBUTION_MODE" == PASSWORD && -z "$ACCESS_PASSWORD" ]]; then
    error "PASSWORD mode requires --access-password"
  fi
  if [[ -n "$ACCESS_PASSWORD" && "$DISTRIBUTION_MODE" != PASSWORD ]]; then
    error "--access-password is valid only with --distribution-mode PASSWORD"
  fi
  case "$COMMAND" in
    preview)
      [[ -n "$DIR" ]] || error "preview requires --dir"
      [[ -z "$DISTRIBUTION_MODE" && -z "$ACCESS_PASSWORD" ]] || error "preview does not change distribution permissions"
      ;;
    create)
      [[ -n "$DIR" && -n "$TITLE" && -n "$SLUG" && -n "$POSTER" ]] || error "create requires --dir --title --slug --poster"
      [[ -n "$DISTRIBUTION_MODE" ]] || error "create requires --distribution-mode"
      ;;
    update)
      [[ -n "$ID" ]] || error "update requires --id"
      [[ -n "$DIR" || -n "$TITLE" || -n "$POSTER" || -n "$DISTRIBUTION_MODE" ]] || error "update has no changes"
      ;;
  esac
  if [[ -n "$DIR" ]]; then
    [[ -d "$DIR" && -f "$DIR/index.html" ]] || error "--dir must contain root index.html"
  fi
  if [[ -n "$POSTER" ]]; then
    [[ -f "$POSTER" ]] || error "poster not found: $POSTER"
    case "$POSTER" in *.png|*.PNG|*.jpg|*.JPG|*.jpeg|*.JPEG) ;; *) error "poster must be png, jpg, or jpeg" ;; esac
  fi
}

run_doctor() {
  local -a args=("$DIR" --require-root-index)
  [[ -z "$SLUG" ]] || args+=(--slug "$SLUG")
  if [[ -n "$POSTER" ]]; then args+=(--poster "$POSTER"); fi
  [[ "$COMMAND" != create ]] || args+=(--require-poster)
  python3 "$DOCTOR" "${args[@]}"
}

make_zip() {
  local src="$1" out="$2"
  python3 - "$src" "$out" <<'PY'
import sys, zipfile
from pathlib import Path
src = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve()
exclude_dirs = {'.git', '.github', '.agents', 'node_modules', '__pycache__'}
exclude_files = {'toy.yaml', '.DS_Store'}
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for p in src.rglob('*'):
        rel = p.relative_to(src)
        if any(part in exclude_dirs or part.startswith('.') for part in rel.parts):
            continue
        if p.is_file() and p.name not in exclude_files and p.resolve() != out:
            z.write(p, rel.as_posix())
PY
}

json_probe() {
  python3 - "$1" "$2" <<'PY'
import json, sys
raw, key = sys.argv[1], sys.argv[2]
try: data = json.loads(raw)
except Exception: print(''); raise SystemExit
def walk(v):
    if isinstance(v, dict):
        if key in v and isinstance(v[key], (str, int, float)): print(v[key]); raise SystemExit
        for x in v.values(): walk(x)
    elif isinstance(v, list):
        for x in v: walk(x)
walk(data); print('')
PY
}

post_form() {
  local endpoint="$1"; shift
  local body status
  local -a args=(curl -sS --connect-timeout "$CURL_CONNECT_TIMEOUT" --max-time "$CURL_MAX_TIME" -X POST)
  args+=(-H "Cookie: $COOKIE" -H "Origin: $API_ORIGIN" -H "Referer: $API_ORIGIN/toy/publish")
  [[ -z "$CSRF" ]] || args+=(-F "csrf=$CSRF" -F "csrf_token=$CSRF")
  args+=("$@")
  body="$(mktemp)"
  status="$("${args[@]}" -o "$body" -w '%{http_code}' "${API_ORIGIN}${API_ROOT}/${endpoint}?uid=${UID_VAL}")" || { rm -f "$body"; error "network request failed"; }
  RESPONSE="$(cat "$body")"; rm -f "$body"
  [[ "$status" == 2* ]] || error "HTTP $status: $RESPONSE"
  local code msg
  code="$(json_probe "$RESPONSE" code)"
  msg="$(json_probe "$RESPONSE" message)"; [[ -n "$msg" ]] || msg="$(json_probe "$RESPONSE" msg)"
  if [[ "$code" == -101 || "$code" == -401 ]]; then warn "login expired or unauthorized"; exit 171; fi
  [[ -z "$code" || "$code" == 0 ]] || error "API error ${code}: ${msg:-unknown error}"
}

main() {
  parse_args "$@"
  validate
  check_auth
  local tmp zip response_url response_id
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  if [[ -n "$DIR" ]]; then
    run_doctor
    zip="$tmp/project.zip"; make_zip "$DIR" "$zip"
    info "Package ready: $(du -h "$zip" | awk '{print $1}')"
  fi
  local -a form=()
  case "$COMMAND" in
    preview)
      form=(-F "file=@$zip")
      info "Uploading preview through ${API_ROOT}/preview"
      post_form preview "${form[@]}"
      response_url="$(json_probe "$RESPONSE" url)"
      [[ -n "$response_url" ]] || error "preview succeeded but no URL was returned"
      success "Preview generated"
      printf 'Preview URL: %s\n' "$response_url"
      ;;
    create)
      form=(-F "title=$TITLE" -F "sub_dir=$SLUG" -F "file=@$zip" -F "poster=@$POSTER" -F "distribution_mode=$DISTRIBUTION_MODE")
      [[ -z "$ACCESS_PASSWORD" ]] || form+=(-F "access_password=$ACCESS_PASSWORD")
      info "Submitting create through ${API_ROOT}/create"
      post_form create "${form[@]}"
      success "Create submitted"
      response_url="$(json_probe "$RESPONSE" url)"; response_id="$(json_probe "$RESPONSE" id)"
      [[ -z "$response_id" ]] || printf 'Project ID: %s\n' "$response_id"
      [[ -z "$response_url" ]] || printf 'URL: %s\n' "$response_url"
      ;;
    update)
      form=(-F "id=$ID")
      [[ -z "$TITLE" ]] || form+=(-F "title=$TITLE")
      [[ -z "${zip:-}" ]] || form+=(-F "file=@$zip")
      [[ -z "$POSTER" ]] || form+=(-F "poster=@$POSTER")
      [[ -z "$DISTRIBUTION_MODE" ]] || form+=(-F "distribution_mode=$DISTRIBUTION_MODE")
      [[ -z "$ACCESS_PASSWORD" ]] || form+=(-F "access_password=$ACCESS_PASSWORD")
      info "Submitting update through ${API_ROOT}/update"
      post_form update "${form[@]}"
      success "Update submitted for project $ID"
      response_url="$(json_probe "$RESPONSE" url)"
      [[ -z "$response_url" ]] || printf 'URL: %s\n' "$response_url"
      ;;
  esac
}

main "$@"
