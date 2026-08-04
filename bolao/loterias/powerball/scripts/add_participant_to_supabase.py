#!/usr/bin/env python3
"""
Add a participant to Supabase for a specific draw.
Usage: python3 add_participant_to_supabase.py --name "Alan Rech" --email "REDACTED_EMAIL" --draw "2026-08-01"
"""

import json
import sys
import urllib.request
import urllib.error

SUPABASE_URL = "https://cmhqkkfczotdnssupkni.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtaHFra2ZjemF0ZG5zc3Vwa25pIiwicm9sZSI6ImFub24iLCJpYXQiOjE2ODQyNjI0MzcsImV4cCI6MTk5OTgzODQzN30.sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"

def add_user(name, email):
    """Add user to users table if not exists."""
    print(f"Adding user: {name} ({email})")
    
    payload = json.dumps({
        "name": name,
        "email": email
    }).encode()
    
    url = f"{SUPABASE_URL}/rest/v1/users"
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=ignore-duplicates"
        },
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            print(f"✓ User added/updated: {name}")
            return True
    except urllib.error.HTTPError as e:
        if e.code == 409:
            print(f"✓ User already exists: {name}")
            return True
        else:
            print(f"✗ Error adding user: {e}")
            return False
    except Exception as e:
        print(f"✗ Exception: {e}")
        return False

def add_participation(name, email, draw_id):
    """Add participation record for a user in a draw."""
    print(f"Adding participation: {name} for draw {draw_id}")
    
    # First, get the user ID
    try:
        url = f"{SUPABASE_URL}/rest/v1/users?email=eq.{email}&select=id"
        req = urllib.request.Request(
            url,
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}"
            }
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
            if not data:
                print(f"✗ User not found in database: {email}")
                return False
            user_id = data[0]["id"]
    except Exception as e:
        print(f"✗ Error fetching user: {e}")
        return False
    
    # Get powerball bolao_type_id
    try:
        url = f"{SUPABASE_URL}/rest/v1/bolao_types?code=eq.powerball&select=id"
        req = urllib.request.Request(
            url,
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}"
            }
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
            if not data:
                print(f"✗ Powerball type not found in database")
                return False
            bolao_type_id = data[0]["id"]
    except Exception as e:
        print(f"✗ Error fetching bolao type: {e}")
        return False
    
    # Add participation
    payload = json.dumps({
        "user_id": user_id,
        "bolao_type_id": bolao_type_id,
        "bolao_draw_id": draw_id,
        "shares": 1,
        "status": "active"
    }).encode()
    
    url = f"{SUPABASE_URL}/rest/v1/user_bolao_participation"
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=ignore-duplicates"
        },
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            print(f"✓ Participation added: {name} in draw {draw_id}")
            return True
    except urllib.error.HTTPError as e:
        if e.code == 409:
            print(f"✓ Participation already exists: {name} in draw {draw_id}")
            return True
        else:
            print(f"✗ Error adding participation: {e}")
            return False
    except Exception as e:
        print(f"✗ Exception: {e}")
        return False

def main():
    args = sys.argv[1:]
    
    name = None
    email = None
    draw_id = None
    
    i = 0
    while i < len(args):
        if args[i] == "--name" and i + 1 < len(args):
            name = args[i + 1]
            i += 2
        elif args[i] == "--email" and i + 1 < len(args):
            email = args[i + 1]
            i += 2
        elif args[i] == "--draw" and i + 1 < len(args):
            draw_id = args[i + 1]
            i += 2
        else:
            i += 1
    
    if not name or not email or not draw_id:
        print("Usage: python3 add_participant_to_supabase.py --name <name> --email <email> --draw <draw_id>")
        print("Example: python3 add_participant_to_supabase.py --name 'Alan Rech' --email 'REDACTED_EMAIL' --draw '2026-08-01'")
        sys.exit(1)
    
    print(f"Adding participant to Supabase:")
    print(f"  Name: {name}")
    print(f"  Email: {email}")
    print(f"  Draw: {draw_id}\n")
    
    if add_user(name, email):
        if add_participation(name, email, draw_id):
            print(f"\n✓ Successfully added {name} to draw {draw_id}")
        else:
            print(f"\n✗ Failed to add participation")
            sys.exit(1)
    else:
        print(f"\n✗ Failed to add user")
        sys.exit(1)

if __name__ == "__main__":
    main()
