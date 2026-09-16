"""Build SQL WHERE clauses from URL query params (shared by /api/data and /api/stats)."""

from wardrivedb.config import FORBIDDEN_RE


def auth_elem_cond(elem: str) -> tuple[str, str]:
    """Return the (SQL, param) that matches one auth element exactly.

    Auth_mode values are either bracketed combos ("[WPA2-PSK-CCMP][ESS]") or
    bare singletons ("WPA", "Open"). A bracketed element is matched as the
    literal format "[…]" — the closing ']' guarantees whole-element equality.
    A bare element (never appears inside a combo, which is always bracketed)
    must therefore match the whole value, so compare with '=' — a bare "WPA"
    must not fuzzy-match "WPA2" or "[WPA2-…]".
    """
    if elem.startswith("[") and elem.endswith("]"):
        return "auth_mode LIKE ?", f"%{elem}%"
    return "auth_mode = ?", elem


def parse_bounds(qs):
    """Extract a (lat_min, lng_min, lat_max, lng_max) bbox tuple, or None."""
    bbox = qs.get("bbox", [None])[0]
    if not bbox:
        return None
    try:
        parts = [float(x) for x in bbox.split(",")]
        if len(parts) == 4:
            return tuple(parts)
    except ValueError:
        pass
    return None


def build_where(qs):
    """Translate query-string params into (where_clause, params) for the networks table."""
    filters: list[str] = []
    params: list = []

    # File filtering - allow filtering by specific file IDs
    file_ids = qs.get("file_ids", [None])[0]
    if file_ids:
        ids = [f.strip() for f in file_ids.split(",") if f.strip()]
        if ids:
            try:
                # Convert to integers and filter
                valid_ids = [int(fid) for fid in ids]
                if valid_ids:
                    filters.append(f"file_id IN ({','.join('?' for _ in valid_ids)})")
                    params.extend(valid_ids)
            except ValueError:
                # Invalid file IDs, ignore
                pass

    types = qs.get("type", [None])[0]
    if types:
        vals = [t.strip() for t in types.split(",") if t.strip()]
        if vals:
            filters.append(f"type IN ({','.join('?' for _ in vals)})")
            params.extend(vals)

    q = qs.get("q", [None])[0]
    if q:
        q = q.strip()
        if len(q) >= 2 and q.startswith("/") and q.endswith("/"):
            filters.append("ssid REGEXP ?")
            params.append(q[1:-1])
        else:
            filters.append("(ssid LIKE ? OR mac LIKE ? OR auth_mode LIKE ?)")
            like = f"%{q}%"
            params.extend([like, like, like])

    auth = qs.get("auth", [None])[0]
    auth_only = qs.get("auth_only", [None])[0] == "true"
    if auth:
        vals = [a.strip() for a in auth.split(",") if a.strip()]
        if vals:
            if auth_only:
                # "Only contains" — net is made solely of the selected auth elements,
                # i.e. its element set ⊆ selected and has ≥1 selected. The selected check
                # is the OR of per-element predicates P_e; the complement is
                # NOT P_e for every known element e not in val. Bare elements use '='
                # (whole-value equality, since combos are always bracketed), bracketed
                # elements use LIKE '%[…]%' where the surrounding brackets are tight.
                # auth_all carries the full known-element inventory from the frontend.
                auth_all_raw = qs.get("auth_all", [None])[0]
                has_sql, has_pars = [], []
                for v in vals:
                    sql, par = auth_elem_cond(v)
                    has_sql.append(sql)
                    has_pars.append(par)
                if auth_all_raw:
                    all_elems = [a.strip() for a in auth_all_raw.split(",") if a.strip()]
                    exclusions = [e for e in all_elems if e not in vals]
                    filters.append(f"({' OR '.join(has_sql)})")
                    params.extend(has_pars)
                    for e in exclusions:
                        sql, par = auth_elem_cond(e)
                        filters.append(f"NOT ({sql})")
                        params.append(par)
                else:
                    # Fallback (frontend always sends auth_all — defensive): just has-selected
                    filters.append(f"({' OR '.join(has_sql)})")
                    params.extend(has_pars)
            else:
                ors_sql, ors_pars = [], []
                for v in vals:
                    sql, par = auth_elem_cond(v)
                    ors_sql.append(sql)
                    ors_pars.append(par)
                filters.append(f"({' OR '.join(ors_sql)})")
                params.extend(ors_pars)

    ch_min = qs.get("channel_min", [None])[0]
    ch_max = qs.get("channel_max", [None])[0]
    if ch_min is not None and ch_min != "":
        try:
            filters.append("channel >= ?")
            params.append(int(ch_min))
        except ValueError:
            pass
    if ch_max is not None and ch_max != "":
        try:
            filters.append("channel <= ?")
            params.append(int(ch_max))
        except ValueError:
            pass

    rssi_min = qs.get("rssi_min", [None])[0]
    rssi_max = qs.get("rssi_max", [None])[0]
    if rssi_min is not None and rssi_min != "":
        try:
            filters.append("rssi >= ?")
            params.append(int(rssi_min))
        except ValueError:
            pass
    if rssi_max is not None and rssi_max != "":
        try:
            filters.append("rssi <= ?")
            params.append(int(rssi_max))
        except ValueError:
            pass

    date_from = qs.get("date_from", [None])[0]
    date_to = qs.get("date_to", [None])[0]
    if date_from:
        filters.append("first_seen >= ?")
        params.append(date_from)
    if date_to:
        v = date_to.strip()
        if len(v) == 10:
            v = v + " 23:59:59"
        filters.append("first_seen <= ?")
        params.append(v)

    bbox = parse_bounds(qs)
    if bbox:
        lat_min, lng_min, lat_max, lng_max = bbox
        if lat_min > lat_max:
            lat_min, lat_max = lat_max, lat_min
        if lng_min > lng_max:
            lng_min, lng_max = lng_max, lng_min
        filters.append("latitude BETWEEN ? AND ?")
        params.extend([lat_min, lat_max])
        filters.append("longitude BETWEEN ? AND ?")
        params.extend([lng_min, lng_max])

    # Accuracy / frequency: when constrained, keep NULL rows (un-populated
    # frequency/accuracy fields) visible so the map doesn't empty on defaults.
    acc_max = qs.get("acc_max", [None])[0]
    if acc_max is not None and acc_max != "":
        try:
            filters.append("(accuracy IS NULL OR accuracy <= ?)")
            params.append(float(acc_max))
        except ValueError:
            pass

    freq_min = qs.get("freq_min", [None])[0]
    freq_max = qs.get("freq_max", [None])[0]
    if freq_min is not None and freq_min != "":
        try:
            filters.append("(frequency IS NULL OR frequency >= ?)")
            params.append(float(freq_min))
        except ValueError:
            pass
    if freq_max is not None and freq_max != "":
        try:
            filters.append("(frequency IS NULL OR frequency <= ?)")
            params.append(float(freq_max))
        except ValueError:
            pass

    # Advanced SQL fragment
    adv = qs.get("adv", [None])[0]
    if adv and adv.strip():
        adv = adv.strip()
        if FORBIDDEN_RE.search(adv):
            filters.append("1 = 0")  # reject — no rows match
        else:
            # Wrap in parens so it can't break the outer WHERE structure
            filters.append(f"({adv})")

    where = (" WHERE " + " AND ".join(filters)) if filters else ""
    return where, params