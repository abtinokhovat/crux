package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func main() {
	r := chi.NewRouter()
	r.Post("/orders", createOrder)
	r.Get("/orders/{id}", getOrder)
	_ = http.ListenAndServe(":8080", r)
}

func createOrder(w http.ResponseWriter, r *http.Request) {}
func getOrder(w http.ResponseWriter, r *http.Request)    {}
