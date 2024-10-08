document.addEventListener("DOMContentLoaded", function() {
    const authorName = "Leon Lufkin";
    const authors = document.querySelectorAll('.author');
  
    authors.forEach(function(author) {
      if (author.textContent.trim() === authorName) {
        author.style.color = 'black';
        author.style.textDecoration = 'underline';
      }
    });
  });
  