import os
import base64
import secrets

def main():
    example_path = '.env.example'
    env_path = '.env'
    
    if os.path.exists(env_path):
        print(f"'{env_path}' already exists. Skipping setup.")
        return
        
    if not os.path.exists(example_path):
        print(f"Error: '{example_path}' not found.")
        return
        
    with open(example_path, 'r') as f:
        lines = f.readlines()
        
    new_lines = []
    for line in lines:
        if 'CHANGE_ME_generate_with_secrets_token_urlsafe_32' in line:
            line = line.replace('CHANGE_ME_generate_with_secrets_token_urlsafe_32', secrets.token_urlsafe(32))
        if 'CHANGE_ME_generate_with_Fernet_generate_key' in line:
            # Generate a valid 32-byte URL-safe base64-encoded key for Fernet
            fernet_key = base64.urlsafe_b64encode(os.urandom(32)).decode()
            line = line.replace('CHANGE_ME_generate_with_Fernet_generate_key', fernet_key)
        if 'CHANGE_ME_minio_root_user' in line:
            line = line.replace('CHANGE_ME_minio_root_user', 'minio_root_user')
        new_lines.append(line)
        
    with open(env_path, 'w') as f:
        f.writelines(new_lines)
        
    print(f"Successfully created '{env_path}' with generated secrets.")

if __name__ == '__main__':
    main()
