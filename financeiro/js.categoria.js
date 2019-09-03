$(function () {

    var $idcategoriapai = $('select[name="idcategoriapai"]');

    $idcategoriapai.on('select2:select', function (e) {
        $('#dc').addClass('hide');
    });
    $idcategoriapai.on('select2:unselecting', function (e) {
        $('#dc').removeClass('hide');
    });


    $('#z1').append(`
        <div id="dc" class="col-md-12 hide">
            <div class="form-group">
                <label>Tipo*</label>
                <div class="row">
                    <div class="col-xs-6">
                        <label><input type="radio" name="dc" value="1"> Débito</label>
                    </div>
                    <div class="col-xs-6">
                        <label><input type="radio" name="dc" value="2"> Crédito</label>
                    </div>
                </div>
            </div>
        </div>
    `);

    if (application.functions.getId() > 0) {
        if (!$('select[name="idcategoriapai"]').val()) {
            $('#dc').removeClass('hide');
        }
        application.jsfunction('sipfinancas.financeiro.categoria.__getDC', { id: application.functions.getId() }, function (response) {
            $('input[name="dc"][value="' + response.data + '"]').prop('checked', true);
        });
    } else {
        $('#dc').removeClass('hide');
    }

});