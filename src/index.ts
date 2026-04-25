import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  ProgressNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import fetch from 'node-fetch'
import { Client as SshClient, ConnectConfig } from 'ssh2'

// ---------------------------------------------------------------------------
// Hetzner Cloud API client
// ---------------------------------------------------------------------------

const HCLOUD_API = 'https://api.hetzner.cloud/v1'

function getToken(): string {
  const token = process.env.HCLOUD_TOKEN?.trim()
  if (!token) {
    throw new Error(
      'HCLOUD_TOKEN environment variable is not set. ' +
      'Create a read/write API token in the Hetzner Cloud Console and set it.'
    )
  }
  return token
}

async function hcloudRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const token = getToken()
  const res = await fetch(`${HCLOUD_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const data = (await res.json()) as Record<string, unknown>

  if (!res.ok) {
    const err = (data.error as Record<string, unknown>) ?? {}
    throw new Error(
      `Hetzner API error ${res.status}: ${err.code ?? res.statusText} — ${err.message ?? JSON.stringify(data)}`
    )
  }

  return data as T
}

// ---------------------------------------------------------------------------
// SSH helper
// ---------------------------------------------------------------------------

interface SshResult {
  stdout: string
  stderr: string
  exitCode: number | null
  host: string
  command: string
}

function sshExecute(
  host: string,
  command: string,
  options: {
    username: string
    password?: string
    privateKey?: string
    port: number
    timeout: number
    pty?: boolean
    onData?: (line: string) => void
  }
): Promise<SshResult> {
  return new Promise((resolve, reject) => {
    const conn = new SshClient()

    const connectConfig: ConnectConfig = {
      host,
      port: options.port,
      username: options.username,
      readyTimeout: options.timeout * 1000,
    }

    if (options.privateKey) {
      connectConfig.privateKey = options.privateKey
    } else if (options.password) {
      connectConfig.password = options.password
    } else {
      reject(new Error('Provide privateKey or password for SSH authentication.'))
      return
    }

    conn.on('ready', () => {
      const execOptions = options.pty ? { pty: true } : {}
      conn.exec(command, execOptions, (err, stream) => {
        if (err) {
          conn.end()
          return reject(err)
        }

        let stdout = ''
        let stderr = ''
        let stdoutBuf = ''

        stream.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf8')
          stdout += text
          if (options.onData) {
            stdoutBuf += text
            const lines = stdoutBuf.split('\n')
            stdoutBuf = lines.pop() ?? ''
            for (const line of lines) {
              options.onData(line)
            }
          }
        })

        stream.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf8')
          stderr += text
          if (options.onData) {
            for (const line of text.split('\n').filter(Boolean)) {
              options.onData('[stderr] ' + line)
            }
          }
        })

        stream.on('close', (exitCode: number | null) => {
          if (options.onData && stdoutBuf) {
            options.onData(stdoutBuf)
          }
          conn.end()
          resolve({ stdout, stderr, exitCode, host, command })
        })
      })
    })

    conn.on('error', (err) => reject(err))
    conn.connect(connectConfig)
  })
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const tools: Tool[] = [
  {
    name: 'list_servers',
    description: 'List all servers in the Hetzner Cloud project with their status, IPs, type, and datacenter.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { title: 'List Servers', readOnlyHint: true },
  },
  {
    name: 'create_server',
    description:
      'Create (provision) a new Hetzner Cloud server. ' +
      'Returns the server details and the root password if no SSH key is provided.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: {
          type: 'string',
          description: 'Unique server name (lowercase, a-z, 0-9, hyphens only).',
        },
        server_type: {
          type: 'string',
          description: 'Server type, e.g. cx22, cx32, cpx11. Use list_server_types to see all options.',
          default: 'cx22',
        },
        image: {
          type: 'string',
          description: 'OS image name, e.g. ubuntu-24.04, debian-12, fedora-40.',
          default: 'ubuntu-24.04',
        },
        location: {
          type: 'string',
          description: 'Datacenter location code: nbg1, fsn1, hel1, ash, sin.',
          default: 'nbg1',
        },
        ssh_key_names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of SSH key names already uploaded to your project.',
        },
        user_data: {
          type: 'string',
          description: 'Optional cloud-init user-data (cloud-config YAML or shell script).',
        },
      },
    },
    annotations: { title: 'Create Server', destructiveHint: false },
  },
  {
    name: 'delete_server',
    description:
      'Permanently destroy a Hetzner Cloud server by name or numeric ID. ' +
      'All data on the server will be lost.',
    inputSchema: {
      type: 'object',
      required: ['name_or_id'],
      properties: {
        name_or_id: {
          type: 'string',
          description: "Server name (e.g. 'my-server') or numeric ID (e.g. '12345678').",
        },
      },
    },
    annotations: { title: 'Delete Server', destructiveHint: true },
  },
  {
    name: 'list_server_types',
    description: 'List all available Hetzner Cloud server types with CPU, RAM, disk, and pricing information.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { title: 'List Server Types', readOnlyHint: true },
  },
  {
    name: 'list_ssh_keys',
    description: 'List all SSH keys uploaded to the Hetzner Cloud project.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { title: 'List SSH Keys', readOnlyHint: true },
  },
  {
    name: 'ssh_execute',
    description:
      'Execute a shell command on a Hetzner Cloud server over SSH. ' +
      'The server IPv4 address is resolved automatically by name or ID. ' +
      'Authenticate with either privateKey (PEM string) or password.',
    inputSchema: {
      type: 'object',
      required: ['name_or_id', 'command'],
      properties: {
        name_or_id: {
          type: 'string',
          description: 'Server name or numeric ID.',
        },
        command: {
          type: 'string',
          description: 'Shell command to run on the remote server.',
        },
        username: {
          type: 'string',
          description: 'SSH username (default: root).',
          default: 'root',
        },
        private_key: {
          type: 'string',
          description: 'PEM-encoded private key as a string (RSA, Ed25519, or ECDSA).',
        },
        password: {
          type: 'string',
          description: 'SSH password. Key-based authentication is preferred.',
        },
        port: {
          type: 'number',
          description: 'SSH port (default: 22).',
          default: 22,
        },
        timeout: {
          type: 'number',
          description: 'Connection timeout in seconds (default: 30).',
          default: 30,
        },
        use_pty: {
          type: 'boolean',
          description: 'Allocate a pseudo-terminal (PTY). Required for commands that need a TTY, e.g. first-login password change on Hetzner servers.',
          default: false,
        },
      },
    },
    annotations: { title: 'SSH Execute', destructiveHint: true },
  },
]

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

interface HcloudServer {
  id: number
  name: string
  status: string
  public_net: {
    ipv4?: { ip: string }
    ipv6?: { ip: string }
  }
  server_type: { name: string }
  datacenter: { name: string }
  created: string
}

interface HcloudServerType {
  name: string
  description: string
  cores: number
  memory: number
  disk: number
  cpu_type: string
  architecture: string
  prices: Array<{
    location: string
    price_monthly: { gross: string }
  }>
}

interface HcloudSshKey {
  id: number
  name: string
  fingerprint: string
  created: string
}

async function handleListServers() {
  const data = await hcloudRequest<{ servers: HcloudServer[] }>('GET', '/servers')
  return data.servers.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    ipv4: s.public_net.ipv4?.ip ?? null,
    ipv6: s.public_net.ipv6?.ip ?? null,
    server_type: s.server_type.name,
    datacenter: s.datacenter.name,
    created: s.created,
  }))
}

async function handleCreateServer(args: Record<string, unknown>) {
  const name = args.name as string
  const serverType = (args.server_type as string | undefined) ?? 'cx22'
  const image = (args.image as string | undefined) ?? 'ubuntu-24.04'
  const location = (args.location as string | undefined) ?? 'nbg1'
  const sshKeyNames = args.ssh_key_names as string[] | undefined
  const userData = args.user_data as string | undefined

  // Resolve SSH key IDs from names
  let sshKeys: string[] | undefined
  if (sshKeyNames && sshKeyNames.length > 0) {
    sshKeys = sshKeyNames
  }

  const body: Record<string, unknown> = {
    name,
    server_type: serverType,
    image,
    location,
  }
  if (sshKeys) body.ssh_keys = sshKeys
  if (userData) body.user_data = userData

  const data = await hcloudRequest<{
    server: HcloudServer
    root_password: string | null
    action: { status: string }
  }>('POST', '/servers', body)

  const s = data.server
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    ipv4: s.public_net.ipv4?.ip ?? null,
    ipv6: s.public_net.ipv6?.ip ?? null,
    server_type: s.server_type.name,
    datacenter: s.datacenter.name,
    created: s.created,
    root_password: data.root_password,
    note: 'Server is being provisioned. It may take 30–60 seconds to become fully reachable via SSH.',
  }
}

async function handleDeleteServer(args: Record<string, unknown>) {
  const nameOrId = args.name_or_id as string

  // Resolve ID: if numeric use directly, else look up by name
  let serverId: number
  if (/^\d+$/.test(nameOrId)) {
    serverId = parseInt(nameOrId, 10)
  } else {
    const data = await hcloudRequest<{ servers: HcloudServer[] }>(
      'GET',
      `/servers?name=${encodeURIComponent(nameOrId)}`
    )
    if (!data.servers.length) {
      throw new Error(
        `Server '${nameOrId}' not found. Use list_servers to see available servers.`
      )
    }
    serverId = data.servers[0].id
  }

  await hcloudRequest('DELETE', `/servers/${serverId}`)
  return { deleted: true, id: serverId, name: nameOrId }
}

async function handleListServerTypes() {
  const data = await hcloudRequest<{ server_types: HcloudServerType[] }>('GET', '/server_types')
  return data.server_types
    .map((t) => {
      const eurPrice = t.prices?.find((p) => p.location === null || !p.location)
      return {
        name: t.name,
        description: t.description,
        cores: t.cores,
        memory_gb: t.memory,
        disk_gb: t.disk,
        cpu_type: t.cpu_type,
        architecture: t.architecture,
        price_monthly_eur: eurPrice?.price_monthly?.gross ?? null,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function handleListSshKeys() {
  const data = await hcloudRequest<{ ssh_keys: HcloudSshKey[] }>('GET', '/ssh_keys')
  return data.ssh_keys.map((k) => ({
    id: k.id,
    name: k.name,
    fingerprint: k.fingerprint,
    created: k.created,
  }))
}

async function handleSshExecute(
  args: Record<string, unknown>,
  onLine?: (line: string) => Promise<void>
) {
  const nameOrId = args.name_or_id as string
  const command = args.command as string
  const username = (args.username as string | undefined) ?? 'root'
  const privateKey = args.private_key as string | undefined
  const password = args.password as string | undefined
  const port = (args.port as number | undefined) ?? 22
  const timeout = (args.timeout as number | undefined) ?? 30
  const usePty = (args.use_pty as boolean | undefined) ?? false

  if (!privateKey && !password) {
    throw new Error('Provide either private_key or password for SSH authentication.')
  }
  if (privateKey && password) {
    throw new Error('Provide only one authentication method: private_key or password.')
  }

  // Resolve server IPv4
  let host: string
  if (/^\d+$/.test(nameOrId)) {
    const data = await hcloudRequest<{ server: HcloudServer }>('GET', `/servers/${nameOrId}`)
    if (!data.server.public_net.ipv4?.ip) {
      throw new Error(`Server '${nameOrId}' has no public IPv4 address.`)
    }
    host = data.server.public_net.ipv4.ip
  } else {
    const data = await hcloudRequest<{ servers: HcloudServer[] }>(
      'GET',
      `/servers?name=${encodeURIComponent(nameOrId)}`
    )
    if (!data.servers.length) {
      throw new Error(
        `Server '${nameOrId}' not found. Use list_servers to see available servers.`
      )
    }
    if (!data.servers[0].public_net.ipv4?.ip) {
      throw new Error(`Server '${nameOrId}' has no public IPv4 address.`)
    }
    host = data.servers[0].public_net.ipv4.ip
  }

  return sshExecute(host, command, {
    username, privateKey, password, port, timeout, pty: usePty,
    onData: onLine ? (line) => { void onLine(line) } : undefined,
  })
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'SecopsHetznerMCP', version: '0.1.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const params = (args ?? {}) as Record<string, unknown>
  const progressToken = request.params._meta?.progressToken

  // Helper to send a progress notification line to the client
  async function sendProgress(line: string) {
    if (progressToken === undefined) return
    await server.notification({
      method: 'notifications/progress',
      params: {
        progressToken,
        progress: 0,
        total: 0,
        message: line,
      },
    })
  }

  try {
    let result: unknown

    switch (name) {
      case 'list_servers':
        result = await handleListServers()
        break
      case 'create_server':
        result = await handleCreateServer(params)
        break
      case 'delete_server':
        result = await handleDeleteServer(params)
        break
      case 'list_server_types':
        result = await handleListServerTypes()
        break
      case 'list_ssh_keys':
        result = await handleListSshKeys()
        break
      case 'ssh_execute':
        result = await handleSshExecute(params, sendProgress)
        break
      default:
        throw new Error(`Unknown tool: ${name}`)
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
      isError: true,
    }
  }
})

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Hetzner MCP server running on stdio')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
