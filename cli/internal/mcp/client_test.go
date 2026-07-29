package mcp

import (
	"reflect"
	"testing"
)

func TestParseSkillList(t *testing.T) {
	got, err := parseSkillList("- org.team.review: Review code\n- personal-skill: Personal\ncontinued description")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"org.team.review", "personal-skill"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestParseSkillListEmpty(t *testing.T) {
	got, err := parseSkillList("No skills available.")
	if err != nil || len(got) != 0 {
		t.Fatalf("got %v, %v", got, err)
	}
}

func TestParseSkillListFailsClosed(t *testing.T) {
	for _, input := range []string{"unexpected", "- bad slug: x", "- ../escape"} {
		if _, err := parseSkillList(input); err == nil {
			t.Fatalf("expected parse error for %q", input)
		}
	}
}
