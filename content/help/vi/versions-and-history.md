## Version bất biến

Lưu chỉnh sửa artifact tạo version mới thay vì ghi đè body trước đó. Cách này
cung cấp bản ghi đáng tin cậy về quá trình nội dung được duy trì và thay đổi.

Current version là version được trả về khi đọc thông thường hoặc khi agent lấy
nội dung. Version cũ vẫn tồn tại trong version history.

## Xem và so sánh

Dùng **View** để xem body của một version cũ. Dùng **Compare versions** để chọn
version nguồn và đích, sau đó review các dòng được thêm, xóa hoặc giữ nguyên.

Trước khi chấp nhận một thay đổi lớn, nên kiểm tra:

- hành vi dự kiến đã thay đổi và nội dung không liên quan không bị ảnh hưởng;
- variable, bundled file hoặc chỉ dẫn task vẫn nhất quán;
- không đưa thêm thông tin nhạy cảm về permission.

## Rollback an toàn

Rollback không xóa lịch sử mới hơn và không âm thầm di chuyển pointer về trước.
Nó sao chép nội dung của version được chọn thành một **version mới**, sau đó đặt
version mới này làm current.

Vì vậy rollback vẫn audit được và có thể tiếp tục compare hoặc đảo ngược. Hãy mô
tả lý do trong changelog nếu editor hỗ trợ.

## Các loại history khác nhau

Version history ghi lại revision của body. Các timeline khác có mục đích riêng:

- Assignment history ghi thay đổi assigner và assignee.
- Audit log ghi hành động quản trị hoặc bảo mật quan trọng.
- Task và workflow status là operational state.

Hãy chọn đúng loại history theo câu hỏi cần điều tra.
