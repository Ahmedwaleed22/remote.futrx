package main

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/futrx-com/remote.futrx.com/pkg/appplugin"
)

func (b *backend) hello(request appplugin.Request) appplugin.Response {
	b.mu.Lock()
	defer b.mu.Unlock()

	// Env carries the install's resolved inputs — here the greeting the user
	// typed into the install dialog, declared as env[] in application.json.
	greeting := b.instance.Env["HELLO_GREETING"]
	// Caller is stamped by the server from the session, never sent by the
	// browser, so a plugin may trust it. The cookies that authenticated it are
	// withheld: this plugin can tell who is asking, and cannot act as them.
	who := request.Caller.Email
	if who == "" {
		who = "there"
	}

	return appplugin.JSON(http.StatusOK, map[string]any{
		"message": fmt.Sprintf("%s, %s.", greeting, who),
		"scope":   b.instance.Scope,
		"project": b.instance.ProjectID,
		"admin":   request.Caller.IsAdmin,
		"visits":  b.visits,
	})
}

func (b *backend) echo(request appplugin.Request) appplugin.Response {
	var body any
	if len(request.Body) > 0 {
		if err := json.Unmarshal(request.Body, &body); err != nil {
			body = string(request.Body)
		}
	}
	return appplugin.JSON(http.StatusOK, map[string]any{
		"method":  request.Method,
		"query":   request.Query,
		"headers": request.Headers,
		"body":    body,
	})
}
