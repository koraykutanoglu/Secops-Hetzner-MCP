# Secops-Hetzner-MCP

---

## 🇹🇷 Türkçe

[Hetzner Cloud](https://www.hetzner.com/cloud) için MCP sunucusu. Sunucu oluşturma, silme ve SSH komutları çalıştırma araçlarını, MCP uyumlu her istemciden (Claude Desktop, VS Code Copilot vb.) erişilebilir şekilde sunar.

### Araçlar

| Araç | Açıklama |
|---|---|
| `list_servers` | Tüm sunucuları durum, IP ve tür bilgileriyle listeler |
| `create_server` | Yeni bir sunucu oluşturur (tür, imaj, konum, SSH anahtarları) |
| `delete_server` | Sunucuyu adı veya ID'si ile kalıcı olarak siler |
| `list_server_types` | Fiyatlandırma dahil CPU/RAM/disk yapılandırmalarını listeler |
| `list_ssh_keys` | Projeye yüklenmiş SSH anahtarlarını listeler |
| `ssh_execute` | SSH üzerinden sunucuda kabuk komutu çalıştırır |

### Gereksinimler

- Node.js 18+
- Hetzner Cloud API token'ı (okuma/yazma) — [Cloud Console](https://console.hetzner.cloud/) → Proje → Güvenlik → API Token'ları bölümünden oluşturun

### Kurulum

```bash
git clone https://github.com/youruser/Secops-Hetzner-MCP.git
cd Secops-Hetzner-MCP
npm install
npm run build
```

### Yapılandırma

Sunucuyu başlatmadan önce API token'ını ortam değişkeni olarak ayarlayın:

```bash
export HCLOUD_TOKEN="token_buraya"
```

#### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` dosyasına ekleyin:

```json
{
  "mcpServers": {
    "hetzner": {
      "command": "node",
      "args": ["$HOME/Documents/github/Secops-Hetzner-MCP/build/index.js"],
      "env": {
        "HCLOUD_TOKEN": "token_buraya"
      }
    }
  }
}
```

#### VS Code (GitHub Copilot)

Merkezi MCP yapılandırma dosyası olan `$HOME/Library/Application Support/Code/User/mcp.json` dosyasına ekleyin:

```json
{
  "servers": {
    "hetzner": {
      "type": "stdio",
      "command": "node",
      "args": ["$HOME/Documents/github/Secops-Hetzner-MCP/build/index.js"],
      "env": {
        "HCLOUD_TOKEN": "token_buraya"
      }
    }
  }
}
```

### Kullanım Örnekleri

**Sunucu oluştur**
```
Frankfurt'ta (fsn1) cx22 türünde, ubuntu-24.04 imajıyla "laptop" SSH anahtarımı
kullanarak "web-01" adında bir sunucu oluştur.
```

**Sunucu sil**
```
"web-01" adlı sunucuyu sil.
```

**SSH komutu çalıştır**
```
"web-01" sunucusunda /home/user/.ssh/id_ed25519 özel anahtarıyla root olarak
"apt-get update && apt-get upgrade -y" komutunu çalıştır.
```

### SSH Kimlik Doğrulama

`ssh_execute` aracı iki kimlik doğrulama yöntemini destekler (aynı anda yalnızca biri kullanılabilir):

- `private_key` — Özel anahtarın PEM dizisi (RSA, Ed25519 veya ECDSA)
- `password` — Düz metin parola (önerilmez)

Anahtar tabanlı kimlik doğrulama kesinlikle tavsiye edilir.

### Güvenlik Notları

- `HCLOUD_TOKEN`'ınızı bir parola yöneticisinde veya ortam değişkeninde saklayın; asla doğrudan koda yazmayın.
- SSH istemcisi, host anahtarlarını otomatik olarak kabul etmek için `AutoAddPolicy` kullanır (yeni oluşturulan cloud VM'ler için uygundur). MITM saldırısı riski olan ortamlarda kullanmayın.
- Mümkün olan her durumda parola yerine SSH anahtarı kullanın.

---

## 🇬🇧 English

MCP server for [Hetzner Cloud](https://www.hetzner.com/cloud). Exposes tools for creating and deleting servers and running SSH commands, all accessible from any MCP-compatible client (Claude Desktop, VS Code Copilot, etc.).

### Tools

| Tool | Description |
|---|---|
| `list_servers` | List all servers with status, IPs, and type |
| `create_server` | Provision a new server (type, image, location, SSH keys) |
| `delete_server` | Permanently destroy a server by name or ID |
| `list_server_types` | Browse available CPU/RAM/disk configurations with pricing |
| `list_ssh_keys` | List SSH keys already uploaded to your project |
| `ssh_execute` | Run a shell command on a server over SSH |

### Requirements

- Node.js 18+
- A Hetzner Cloud API token (read/write) — create one in the [Cloud Console](https://console.hetzner.cloud/) → Project → Security → API Tokens

### Installation

```bash
git clone https://github.com/youruser/Secops-Hetzner-MCP.git
cd Secops-Hetzner-MCP
npm install
npm run build
```

### Configuration

Set the API token as an environment variable before starting the server:

```bash
export HCLOUD_TOKEN="your_token_here"
```

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hetzner": {
      "command": "node",
      "args": ["$HOME/Documents/github/Secops-Hetzner-MCP/build/index.js"],
      "env": {
        "HCLOUD_TOKEN": "your_token_here"
      }
    }
  }
}
```

#### VS Code (GitHub Copilot)

Add to the central MCP configuration file at `$HOME/Library/Application Support/Code/User/mcp.json`:

```json
{
  "servers": {
    "hetzner": {
      "type": "stdio",
      "command": "node",
      "args": ["$HOME/Documents/github/Secops-Hetzner-MCP/build/index.js"],
      "env": {
        "HCLOUD_TOKEN": "your_token_here"
      }
    }
  }
}
```

### Usage Examples

**Create a server**
```
Create a server named "web-01" with type cx22, image ubuntu-24.04 in Frankfurt (fsn1),
using my SSH key "laptop".
```

**Delete a server**
```
Delete the server named "web-01".
```

**Run an SSH command**
```
On server "web-01", run "apt-get update && apt-get upgrade -y" as root using the
private key at /home/user/.ssh/id_ed25519.
```

### Authentication for SSH

The `ssh_execute` tool supports two mutually exclusive authentication methods:

- `private_key` — PEM string of a private key (RSA, Ed25519, or ECDSA)
- `password` — plain password (not recommended)

Key-based authentication is strongly recommended.

### Security Notes

- Store your `HCLOUD_TOKEN` in a secrets manager or environment, never hard-code it.
- The SSH client uses `AutoAddPolicy` to accept host keys automatically (suitable for freshly provisioned cloud VMs). Do not reuse this against hosts where MITM attacks are a concern.
- Use SSH keys rather than passwords wherever possible.
