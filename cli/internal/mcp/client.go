// Package mcp is a minimal client for Agent Hub's stateless /api/mcp
// endpoint — just enough to call pull_skill/pull_kit. It talks raw
// JSON-RPC-over-HTTP with the stdlib only (no MCP SDK): the endpoint accepts
// a bare "tools/call" with no "initialize" handshake in stateless mode
// (proven by qa/e2e/mcp-http.spec.ts), so there's nothing else to implement.
package mcp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"agent-hub-cli/internal/config"
)

type Client struct {
	cfg  config.Config
	http *http.Client
}

func NewClient(cfg config.Config) *Client {
	return &Client{cfg: cfg, http: &http.Client{Timeout: 60 * time.Second}}
}

type rpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int    `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params"`
}

type toolCallParams struct {
	Name      string            `json:"name"`
	Arguments map[string]string `json:"arguments"`
}

type contentItem struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type toolCallResult struct {
	Content []contentItem `json:"content"`
	IsError bool          `json:"isError"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type rpcResponse struct {
	Result *toolCallResult `json:"result"`
	Error  *rpcError       `json:"error"`
}

// callTool posts a tools/call request and returns the tool's first text
// content block.
func (c *Client) callTool(name string, args map[string]string) (string, error) {
	body, err := json.Marshal(rpcRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "tools/call",
		Params:  toolCallParams{Name: name, Arguments: args},
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(c.cfg.BaseURL, "/")+"/api/mcp", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("Authorization", "Bearer "+c.cfg.Token)

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("could not reach %s: %w", c.cfg.BaseURL, err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusUnauthorized:
		return "", fmt.Errorf("unauthorized — the token may be revoked; run `agent-hub login` again")
	case http.StatusTooManyRequests:
		retryAfter := resp.Header.Get("Retry-After")
		if retryAfter != "" {
			return "", fmt.Errorf("rate limited — retry after %ss", retryAfter)
		}
		return "", fmt.Errorf("rate limited — try again shortly")
	}
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("unexpected response %d from %s: %s", resp.StatusCode, c.cfg.BaseURL, string(b))
	}

	data, err := parseSSE(resp.Body)
	if err != nil {
		return "", err
	}
	var rpc rpcResponse
	if err := json.Unmarshal(data, &rpc); err != nil {
		return "", fmt.Errorf("could not parse response: %w", err)
	}
	if rpc.Error != nil {
		return "", fmt.Errorf("%s", rpc.Error.Message)
	}
	if rpc.Result == nil || len(rpc.Result.Content) == 0 {
		return "", fmt.Errorf("%s returned no content", name)
	}
	return rpc.Result.Content[0].Text, nil
}

// parseSSE extracts the JSON payload from the first "data: " line of an SSE
// response body — the WebStandardStreamableHTTPServerTransport always wraps
// tool-call responses this way, even in stateless mode.
func parseSSE(body io.Reader) ([]byte, error) {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if payload, ok := strings.CutPrefix(line, "data: "); ok {
			return []byte(payload), nil
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return nil, fmt.Errorf(`no SSE "data:" line in response body`)
}

// callPullTool calls pull_skill/pull_kit and decodes the result into v,
// mirroring the TS client's error convention: these two tools always return
// valid JSON — either the bundle or {"error": "..."} — never isError.
func callPullTool(c *Client, name, slug string, v any) error {
	text, err := c.callTool(name, map[string]string{"slug": slug})
	if err != nil {
		return err
	}
	var probe bundleError
	if err := json.Unmarshal([]byte(text), &probe); err == nil && probe.Error != "" {
		return fmt.Errorf("%s", probe.Error)
	}
	if err := json.Unmarshal([]byte(text), v); err != nil {
		return fmt.Errorf("could not parse %s('%s') response: %w", name, slug, err)
	}
	return nil
}

func (c *Client) PullSkill(slug string) (SkillBundle, error) {
	var bundle SkillBundle
	err := callPullTool(c, "pull_skill", slug, &bundle)
	return bundle, err
}

func (c *Client) PullKit(slug string) (KitBundle, error) {
	var bundle KitBundle
	err := callPullTool(c, "pull_kit", slug, &bundle)
	return bundle, err
}
