// crux — visual, connected Architecture Decision Records.
package main

import (
	"os"

	"github.com/abtinokhovat/crux/internal/cli"
)

var version = "dev"

func main() {
	cli.Version = version
	os.Exit(cli.Main(os.Args[1:]))
}
